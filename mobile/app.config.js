const { configureOta } = require('./tools/ota-policy.cjs');

// Keep app.json as the native app's source of truth. OTA identity is explicitly
// supplied by the owner's real Expo project; never generated or guessed here.
module.exports = ({ config }) => configureOta(config, process.env);
