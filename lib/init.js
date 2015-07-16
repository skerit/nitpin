// Require protoblast (without native mods) if it isn't loaded yet
if (typeof __Protoblast == 'undefined') {
	require('protoblast')(false);
}

module.exports = require('./nitpin');