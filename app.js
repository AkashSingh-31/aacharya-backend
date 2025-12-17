// --- Imports ---
const express = require("express");
const { v4: uuidv4 } = require("uuid");
const cors = require("cors");
const { fetchEnrolledClassesWithParents } = require("./helper");

/**
 * Creates and configures the Express application with all routes and middleware.
 * @param {admin.firestore.Firestore} db - The configured Firestore instance.
 * @param {Object} admin - The configured Firebase Admin SDK instance.
 * @returns {express.Application} The configured Express app.
 */
function createApp(db, admin) {
  const app = express();

  // Define session duration in milliseconds (24 hours)
  const SESSION_DURATION_MS = 24 * 60 * 60 * 1000;

  const sessionsCollection = db.collection("sessions");
  const usersCollection = db.collection("user");
  const rolesCollection = db.collection("roles");

  // Middleware to parse JSON bodies
  app.use(express.json());

  // --- CORS Middleware ---
  app.use(cors());

  /**
   * Marks all active sessions for a given user as inactive.
   */
  async function cleanupPreviousSessions(userId) {
    const oldSessionsSnapshot = await sessionsCollection
      .where("userId", "==", userId)
      .where("isActive", "==", true)
      .get();

    if (!oldSessionsSnapshot.empty) {
      const batch = db.batch();
      oldSessionsSnapshot.docs.forEach((doc) => {
        batch.update(doc.ref, {
          isActive: false,
          logoutTime: admin.firestore.FieldValue.serverTimestamp(),
        });
      });
      await batch.commit();
      console.log(
        `Cleaned up ${oldSessionsSnapshot.size} previous active sessions for user ${userId}.`
      );
    }
  }

  // --- Authentication Middleware ---

  async function authenticateToken(req, res, next) {
    try {
      const authHeader = req.headers["authorization"];
      const token = authHeader && authHeader.split(" ")[1];

      if (!token) {
        return res.status(401).json({ error: "Authorization token required." });
      }

      const sessionDoc = await sessionsCollection.doc(token).get();

      if (!sessionDoc.exists) {
        return res.status(403).json({ error: "Invalid token." });
      }

      const session = sessionDoc.data();

      if (session.isActive === false) {
        return res
          .status(403)
          .json({ error: "Session expired or invalidated." });
      }

      if (
        session.expiresAt &&
        session.expiresAt instanceof admin.firestore.Timestamp
      ) {
        const now = admin.firestore.Timestamp.now().toMillis();
        const expiresAtMillis = session.expiresAt.toMillis();

        if (now > expiresAtMillis) {
          await sessionDoc.ref.update({ isActive: false });
          return res
            .status(403)
            .json({ error: "Session expired due to inactivity." });
        }
      }

      const userId = session.userId;
      const userDoc = await usersCollection.doc(userId).get();

      if (!userDoc.exists) {
        return res.status(404).json({ error: "User not found." });
      }

      const user = userDoc.data();
      req.user = user;
      req.userId = userDoc.id;

      next();
    } catch (error) {
      console.error("Authentication error:", error.message);
      return res
        .status(500)
        .json({ error: "Internal server error during authentication." });
    }
  }

  // --- API Endpoints ---

  /**
   * POST /reset-password
   * REQUIRES AUTHENTICATION (via token). Updates the logged-in user's password.
   * Takes: { newPassword } in body
   * Uses: token in Authorization header
   */
  app.post("/reset-password", authenticateToken, async (req, res) => {
    const { newPassword } = req.body;
    const userId = req.userId;

    if (!newPassword) {
      return res.status(400).json({ error: "newPassword is required." });
    }

    try {
      const userDocRef = usersCollection.doc(userId);

      await userDocRef.update({
        password_hash: newPassword,
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        is_new: false,
      });

      res.json({
        message: "Password successfully updated for the authenticated user.",
        userId: userId,
      });
    } catch (error) {
      console.error("Reset Password error:", error.message, error.stack);
      res.status(500).json({
        error: "An unexpected server error occurred during password reset.",
      });
    }
  });

  /**
   * POST /login
   * Authenticates user, cleans up old tokens, and creates a new expiring session.
   */
  app.post("/login", async (req, res) => {
    const { email, password } = req.body;

    if (!email || !password) {
      return res
        .status(400)
        .json({ error: "Email and password are required." });
    }

    try {
      const snapshot = await usersCollection
        .where("email", "==", email)
        .limit(1)
        .get();

      if (snapshot.empty) {
        return res.status(401).json({ error: "Invalid email or password." });
      }

      const userDoc = snapshot.docs[0];
      const user = userDoc.data();
      const userId = userDoc.id;

      if (user.password_hash !== password) {
        return res.status(401).json({ error: "Invalid email or password." });
      }

      // 1. Clean up any previous active sessions for this user
      await cleanupPreviousSessions(userId);

      // 2. Generate new session token and expiry time
      const sessionToken = uuidv4();
      const expiresAt = admin.firestore.Timestamp.fromMillis(
        Date.now() + SESSION_DURATION_MS
      );

      // 3. Create a single new session record
      await sessionsCollection.doc(sessionToken).set({
        userId: userId,
        loginTime: admin.firestore.FieldValue.serverTimestamp(),
        expiresAt: expiresAt,
        isActive: true,
      });

      const { is_new } = user;

      res.json({
        message: "Login successful",
        token: sessionToken,
        expiresAt: expiresAt.toDate(),
        user: {
          id: userId,
          is_new,
        },
      });
    } catch (error) {
      console.error("Login error:", error.message, error.stack);
      res.status(500).json({ error: "An unexpected server error occurred." });
    }
  });

  /**
   * POST /logout
   * REQUIRES AUTHENTICATION. Marks the current session token as inactive.
   */
  app.post("/logout", authenticateToken, async (req, res) => {
    try {
      const authHeader = req.headers["authorization"];
      const token = authHeader && authHeader.split(" ")[1];

      await sessionsCollection.doc(token).update({
        isActive: false,
        logoutTime: admin.firestore.FieldValue.serverTimestamp(),
      });

      res.json({ message: "Logout successful. Session invalidated." });
    } catch (error) {
      console.error("Logout error:", error.message);
      res.status(200).json({ message: "Logout process complete." });
    }
  });

  /**
   * GET /api/profile
   * REQUIRES AUTHENTICATION. Returns the currently logged-in user's data.
   */
  app.get("/profile", authenticateToken, (req, res) => {
    const { password_hash, ...safeUser } = req.user;

    res.json({
      message: "Authenticated profile data",
      user: safeUser,
      userId: req.userId,
    });
  });

  /**
   * GET /classes
   * REQUIRES AUTHENTICATION (via token). Retrieves the list of classes enrolled
   * for the authenticated user.
   */
  app.get("/classes", authenticateToken, async (req, res) => {
    try {
      const userId = req.userId;

      const subjectsWithClasses = await fetchEnrolledClassesWithParents(
        db,
        usersCollection,
        userId
      );

      if (subjectsWithClasses.length === 0) {
        const userDoc = await usersCollection.doc(userId).get();
        const userData = userDoc.data();
        const enrolledRefs = Array.isArray(userData.enrolled_classes)
          ? userData.enrolled_classes
          : [];

        if (enrolledRefs.length === 0) {
          return res.status(200).json({
            message: "User is not currently enrolled in any subjects.",
            subjects: [],
          });
        } else {
          return res.status(200).json({
            message:
              "User is enrolled, but no valid subject data was retrieved.",
            subjects: [],
          });
        }
      }

      res.json({
        message: `Successfully retrieved ${subjectsWithClasses.length} enrolled subject(s) with parent class data.`,
        subjects: subjectsWithClasses,
      });
    } catch (error) {
      // Check for specific error thrown by the helper
      if (error.message === "User profile not found.") {
        return res.status(404).json({ error: error.message });
      }

      console.error("API /api/classes error:", error.message, error.stack);
      res.status(500).json({
        error: "An unexpected server error occurred while fetching class data.",
      });
    }
  });

  /**
   * GET /user-role-config
   * REQUIRES AUTHENTICATION (via token). Retrieves the configuration JSON
   * corresponding to the authenticated user's role (user_type).
   */
  app.get("/user-role-config", authenticateToken, async (req, res) => {
    try {
      const userRole = req.user.user_role;

      if (!userRole) {
        return res.status(404).json({
          error: "User role (user_type) is missing in the user profile.",
        });
      }

      const roleDoc = await rolesCollection.doc(userRole).get();

      if (!roleDoc.exists) {
        console.warn(`Role configuration not found for role: ${userRole}`);
        return res.status(404).json({
          error: `Configuration not found for user role: ${userRole}.`,
        });
      }

      res.json({
        message: `Configuration retrieved for role: ${userRole}`,
        role_config: roleDoc.data(),
      });
    } catch (error) {
      console.error(
        "API /api/user-role-config error:",
        error.message,
        error.stack
      );
      res.status(500).json({
        error:
          "An unexpected server error occurred while fetching role configuration.",
      });
    }
  });

  /**
   * POST /timetable
   * Inserts or edits the entire timetable document for a specific class.
   * The target path is: school/{school_id}/classes/{class_id}/timetable/current_schedule
   * Requires authentication.
   */
  app.post("/timetable", authenticateToken, async (req, res) => {
    try {
      const userId = req.userId;
      const userRole = req.user.user_role;

      // Authorization Check: Only administrators and teachers can update the timetable
      if (userRole !== "admin" && userRole !== "teacher") {
        return res.status(403).json({
          error:
            "Forbidden: Only administrators and teachers can update the timetable.",
        });
      }
      // The class_id is needed to form the path, and weekdays is the data to be saved.
      const { class_id, weekdays } = req.body;
      // Assuming the authenticated user object has the school_id field
      const schoolId = req.user.school_id;

      // 1. Input Validation
      if (
        !class_id ||
        !weekdays ||
        typeof weekdays !== "object" ||
        Array.isArray(weekdays)
      ) {
        return res.status(400).json({
          error:
            "Missing or invalid data: class_id and weekdays object are required in the request body.",
        });
      }
      if (!schoolId) {
        return res.status(400).json({
          error:
            "School ID missing from authenticated user profile. Cannot determine timetable location.",
        });
      }

      // 2. Define the target Firestore path (DocumentReference)
      // We use 'current_schedule' as a fixed document ID within the 'timetable' collection
      const timetableDocRef = db
        .collection("school")
        .doc(schoolId)
        .collection("classes")
        .doc(class_id)
        .collection("timetable")
        .doc("current_schedule");

      const timetableData = {
        weekdays: weekdays,
        updatedBy: userId,
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      };

      // 3. Upsert (Insert or Edit) the document
      // Using set() will overwrite the existing document or create a new one.
      await timetableDocRef.set(timetableData);

      res.json({
        message: `Timetable successfully updated for class ${class_id} in school ${schoolId}.`,
        timetablePath: timetableDocRef.path,
      });
    } catch (error) {
      console.error("API /api/timetable error:", error.message, error.stack);
      res.status(500).json({
        error:
          "An unexpected server error occurred while processing the timetable request.",
      });
    }
  });

  /**
   * GET /timetable
   * Retrieves the current timetable document for a specific class.
   * Path: school/{school_id}/classes/{class_id}/timetable/current_schedule
   * Requires authentication. class_id is passed as a query parameter.
   */
  app.get("/timetable", authenticateToken, async (req, res) => {
    try {
      // class_id is expected as a query parameter: /api/timetable?class_id=ClassA
      const classId = req.query.class_id;
      // school_id is derived from the authenticated user
      const schoolId = req.user.school_id;

      // 1. Input Validation
      if (!classId) {
        return res
          .status(400)
          .json({
            error:
              "Missing parameter: class_id is required as a query parameter.",
          });
      }
      if (!schoolId) {
        return res
          .status(400)
          .json({
            error:
              "School ID missing from authenticated user profile. Cannot determine timetable location.",
          });
      }

      // 2. Define the target Firestore path (DocumentReference)
      const timetableDocRef = db
        .collection("school")
        .doc(schoolId)
        .collection("classes")
        .doc(classId)
        .collection("timetable")
        .doc("current_schedule");

      // 3. Retrieve the document
      const docSnap = await timetableDocRef.get();

      if (!docSnap.exists) {
        return res.status(404).json({
          message: `Timetable not found for class ${classId}.`,
          timetablePath: timetableDocRef.path,
          weekdays: {}, // Return an empty object for consistency
        });
      }

      // 4. Return the timetable data
      res.json({
        message: `Timetable successfully retrieved for class ${classId}.`,
        timetablePath: timetableDocRef.path,
        ...docSnap.data(),
      });
    } catch (error) {
      console.error(
        "API /api/timetable (GET) error:",
        error.message,
        error.stack
      );
      res.status(500).json({
        error:
          "An unexpected server error occurred while retrieving the timetable.",
      });
    }
  });

  /**
   * GET /
   * Root check.
   */
  app.get("/", (req, res) => {
    res.status(200).send(`Backend App is running!`);
  });

  return app;
}

module.exports = createApp;
