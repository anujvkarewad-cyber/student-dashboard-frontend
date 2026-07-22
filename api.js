
const APPS_SCRIPT_URL = "/api/proxy";
async function callAPI(action, payload = {}) {

  const response = await fetch(APPS_SCRIPT_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      action,
      payload
    })
  });

  const data = await response.json();

  if (data.error) {
    throw new Error(data.error);
  }

  return data.result;
}
window.UMP_API = {

  validateLogin(studentId, password) {
    return callAPI("validateLogin", { studentId, password });
  },

  validateStudent(studentId) {
    return callAPI("validateStudent", { studentId });
  },

  changePassword(studentId, currentPassword, newPassword) {
    return callAPI("changePassword", {
      studentId,
      currentPassword,
      newPassword
    });
  },

  getStats(studentId) {
    return callAPI("getStats", { studentId });
  },

  getStudyLog(studentId) {
    return callAPI("getStudyLog", { studentId });
  },

  getLeaderboard() {
    return callAPI("getLeaderboard");
  },

  async getWeeklyReports(studentId) {
    return [];
  },

  testConnection() {
    return Promise.resolve(true);
  },

  getMentorFeedback(studentId) {
    return callAPI("getStudentFeedback", { studentId });
  },

  getAnnouncements() {
    return callAPI("getAnnouncements");
  },

  getStudentMentorNotes(studentId) {
    return callAPI("getStudentMentorNotes", { studentId });
  }

};
