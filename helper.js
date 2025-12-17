/**
 * Extracts the path of the parent class document from a subject reference path.
 * The structure is assumed to be: /.../classes/{classId}/subjects/{subjectId}
 * Example: '/school/school1/classes/FirstA/subjects/maths' -> '/school/school1/classes/FirstA'
 * * @param {string|admin.firestore.DocumentReference} ref - The subject reference (can be a string path or a DocumentReference object).
 * @returns {string|null} The parent class path string, or null if invalid.
 */
function getParentClassRefPath(ref) {
  let pathString;

  // Determine the path string from either a DocumentReference object or a string
  if (typeof ref === "string" && ref.startsWith("/")) {
    pathString = ref;
  } else if (typeof ref === "object" && ref !== null && ref.path) {
    pathString = ref.path;
  } else {
    return null;
  }

  const segments = pathString.split("/").filter((s) => s.length > 0);

  if (segments.length >= 5 && segments[segments.length - 2] === "subjects") {
    return "/" + segments.slice(0, segments.length - 2).join("/");
  }

  return null;
}

/**
 * Fetches all enrolled subjects for a user and retrieves the data for their parent class document as well.
 * * @param {admin.firestore.Firestore} db - The Firestore instance.
 * @param {admin.firestore.CollectionReference} usersCollection - The reference to the 'user' collection.
 * @param {string} userId - The ID of the authenticated user.
 * @returns {Promise<Array<Object>>} A promise that resolves to an array of subjects, each containing its parentClass data.
 * @throws {Error} Throws an error if the user profile is not found.
 */
async function fetchEnrolledClassesWithParents(db, usersCollection, userId) {
  const userDoc = await usersCollection.doc(userId).get();

  if (!userDoc.exists) {
    throw new Error("User profile not found.");
  }

  const userData = userDoc.data();
  const enrolledRefs = Array.isArray(userData.enrolled_classes)
    ? userData.enrolled_classes
    : [];

  if (enrolledRefs.length === 0) {
    return [];
  }

  const fetchPromises = [];
  const validSubjectRefs = [];

  enrolledRefs.forEach((refItem) => {
    let subjectRef;

    if (
      typeof refItem === "object" &&
      refItem !== null &&
      typeof refItem.get === "function"
    ) {
      subjectRef = refItem;
    } else if (typeof refItem === "string" && refItem.startsWith("/")) {
      subjectRef = db.doc(refItem);
    } else {
      console.warn(
        `Skipping invalid Firestore reference found in user profile: ${refItem}`
      );
      return;
    }

    const subjectPath = subjectRef.path;
    const parentPath = getParentClassRefPath(subjectRef);

    if (!parentPath) {
      console.warn(
        `Could not determine parent class path for subject: ${subjectPath}`
      );
      return;
    }

    fetchPromises.push(subjectRef.get());
    fetchPromises.push(db.doc(parentPath).get());

    validSubjectRefs.push({ subjectPath, parentPath });
  });

  if (fetchPromises.length === 0) {
    return [];
  }

  const snapshots = await Promise.all(fetchPromises);
  const subjectsWithClasses = [];

  for (let i = 0; i < snapshots.length; i += 2) {
    const subjectSnapshot = snapshots[i];
    const classSnapshot = snapshots[i + 1];
    const refContext = validSubjectRefs[i / 2];

    if (subjectSnapshot && subjectSnapshot.exists) {
      const subjectData = subjectSnapshot.data();
      let classData = null;

      if (classSnapshot && classSnapshot.exists) {
        classData = {
          id: classSnapshot.id,
          // refPath: classSnapshot.ref.path,
          ...classSnapshot.data(),
        };
      } else {
        console.warn(`Parent class not found at: ${refContext.parentPath}`);
      }

      subjectsWithClasses.push({
        id: subjectSnapshot.id,
        refPath: subjectSnapshot.ref.path,
        ...subjectData,
        parentClass: classData,
      });
    } else {
      console.warn(`Subject document not found at: ${refContext.subjectPath}`);
    }
  }

  return subjectsWithClasses;
}

module.exports = {
  getParentClassRefPath,
  fetchEnrolledClassesWithParents,
};
