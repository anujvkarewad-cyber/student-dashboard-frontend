<script>

window.UMP_API = {

  // ==========================
  // LOGIN
  // ==========================
  validateLogin(studentId, password) {
    return new Promise((resolve, reject) => {
      google.script.run
        .withSuccessHandler(resolve)
        .withFailureHandler(reject)
        .validateLogin(studentId, password);
    });
  },

  validateStudent(studentId) {
    return new Promise((resolve, reject) => {
      google.script.run
        .withSuccessHandler(resolve)
        .withFailureHandler(reject)
        .validateStudent(studentId);
    });
  },

  changePassword(studentId, currentPassword, newPassword) {
    return new Promise((resolve, reject) => {
      google.script.run
        .withSuccessHandler(resolve)
        .withFailureHandler(reject)
        .changePassword(studentId, currentPassword, newPassword);
    });
  },

  // ==========================
  // DASHBOARD
  // ==========================
  getStats(studentId) {
    return new Promise((resolve, reject) => {
      google.script.run
        .withSuccessHandler(resolve)
        .withFailureHandler(reject)
        .getStats(studentId);
    });
  },

  getStudyLog(studentId) {
    return new Promise((resolve, reject) => {
      google.script.run
        .withSuccessHandler(resolve)
        .withFailureHandler(reject)
        .getStudyLog(studentId);
    });
  },

  getLeaderboard() {
    return new Promise((resolve, reject) => {
      google.script.run
        .withSuccessHandler(resolve)
        .withFailureHandler(reject)
        .getLeaderboard();
    });
  },

  // ==========================
  // REPORTS
  // ==========================
  async getWeeklyReports(studentId) {
    return [];
  },

  // ==========================
  // TEST
  // ==========================
  testConnection() {
    return new Promise((resolve, reject) => {
      google.script.run
        .withSuccessHandler(resolve)
        .withFailureHandler(reject)
        .testConnection();
    });
  },

  // ==========================
  // MENTOR FEEDBACK
  // ==========================
  getMentorFeedback(studentId) {
    return new Promise((resolve, reject) => {
      google.script.run
        .withSuccessHandler(resolve)
        .withFailureHandler(reject)
        .getStudentFeedback(studentId);
    });
  },

  getAnnouncements() {

  return new Promise((resolve, reject) => {

    google.script.run
      .withSuccessHandler(resolve)
      .withFailureHandler(reject)
      .getAnnouncements();

  });

},
getStudentMentorNotes(studentId) {
  return new Promise((resolve, reject) => {

    google.script.run
      .withSuccessHandler(resolve)
      .withFailureHandler(reject)
      .getStudentMentorNotes(studentId);

  });
},
}
</script>