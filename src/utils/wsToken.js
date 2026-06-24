const jwt       = require('jsonwebtoken');
const Workspace = require('../models/Workspace');

const signWsToken = (wsId, uid) =>
  jwt.sign(
    { type: 'ws-access', wsId: String(wsId), uid: String(uid) },
    process.env.JWT_SECRET,
    { expiresIn: '8h' }
  );

// Returns { status, message, code } if access denied, null if allowed
const checkWorkspaceAccess = async (req, wsId) => {
  if (!wsId) return null;

  const ws = await Workspace.findById(wsId).select('lockPassword').lean();
  if (!ws?.lockPassword) return null;       // workspace not locked
  if (req.user.role === 'admin') return null; // admin always has access

  const token = req.headers['x-workspace-token'];
  if (!token) {
    return { status: 403, message: 'This workspace is locked — enter the password to access it', code: 'WORKSPACE_LOCKED' };
  }

  try {
    const d = jwt.verify(token, process.env.JWT_SECRET);
    if (d.type !== 'ws-access' || d.wsId !== String(wsId) || d.uid !== String(req.user._id)) {
      return { status: 403, message: 'Invalid workspace access token', code: 'WORKSPACE_LOCKED' };
    }
    return null; // access granted
  } catch {
    return { status: 403, message: 'Workspace access expired — re-enter the password', code: 'WORKSPACE_LOCKED' };
  }
};

module.exports = { signWsToken, checkWorkspaceAccess };
