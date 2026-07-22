

window.UMP_API = {
const APPS_SCRIPT_URL =
"https://script.google.com/macros/s/AKfycbzyfWa8agayMB0XLjkbfhfj2MdIRElAiY2Wnd7-eQKd1zlMl099ky6Cif06TWydzr8D/exec";
  // ==========================
  // LOGIN
  // ==========================
validateLogin(studentId, password) {

  return fetch(APPS_SCRIPT_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      action: "validateLogin",
      payload: {
        studentId,
        password
      }
    })
  })
  .then(res => res.json())
  .then(data => {
    if (data.error) throw new Error(data.error);
    return data.result;
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
