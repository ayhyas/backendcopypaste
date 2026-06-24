const Workspace = require('../models/Workspace');
const Clip = require('../models/Clip');

exports.getWorkspaces = async (req, res, next) => {
  try {
    const workspaces = await Workspace.find().sort({ createdAt: 1 }).lean();

    const counts = await Clip.aggregate([
      { $match: { workspace: { $ne: null } } },
      { $group: { _id: '$workspace', count: { $sum: 1 } } },
    ]);
    const countMap = {};
    counts.forEach(({ _id, count }) => { countMap[String(_id)] = count; });

    const isAdmin = req.user.role === 'admin';
    const data = workspaces.map((w) => ({
      ...w,
      clipCount: countMap[String(w._id)] || 0,
      isLocked: !!w.lockPassword,
      lockPassword: isAdmin ? w.lockPassword : undefined,
    }));
    res.json({ success: true, data });
  } catch (error) {
    next(error);
  }
};

exports.createWorkspace = async (req, res, next) => {
  try {
    const { name } = req.body;
    if (!name?.trim()) {
      return res.status(400).json({ success: false, message: 'Name is required' });
    }

    const workspace = await Workspace.create({
      name: name.trim(),
      owner: req.user._id,
      ownerName: req.user.username,
    });

    const payload = { ...workspace.toObject(), clipCount: 0 };
    req.io.emit('workspace:new', { data: payload });
    res.status(201).json({ success: true, data: payload });
  } catch (error) {
    next(error);
  }
};

exports.renameWorkspace = async (req, res, next) => {
  try {
    const workspace = await Workspace.findById(req.params.id);
    if (!workspace) {
      return res.status(404).json({ success: false, message: 'Workspace not found' });
    }
    if (workspace.owner.toString() !== req.user._id.toString() && req.user.role !== 'admin') {
      return res.status(403).json({ success: false, message: 'Only the creator or an admin can rename this workspace' });
    }

    const { name } = req.body;
    if (!name?.trim()) {
      return res.status(400).json({ success: false, message: 'Name is required' });
    }

    workspace.name = name.trim();
    await workspace.save();

    req.io.emit('workspace:updated', { data: workspace });
    res.json({ success: true, data: workspace });
  } catch (error) {
    next(error);
  }
};

exports.deleteWorkspace = async (req, res, next) => {
  try {
    const workspace = await Workspace.findById(req.params.id);
    if (!workspace) {
      return res.status(404).json({ success: false, message: 'Workspace not found' });
    }
    if (workspace.owner.toString() !== req.user._id.toString() && req.user.role !== 'admin') {
      return res.status(403).json({ success: false, message: 'Only the creator or an admin can delete this workspace' });
    }

    await Clip.updateMany({ workspace: workspace._id }, { workspace: null });
    await workspace.deleteOne();

    req.io.emit('workspace:deleted', { id: req.params.id });
    res.json({ success: true, message: 'Workspace deleted' });
  } catch (error) {
    next(error);
  }
};

exports.lockWorkspace = async (req, res, next) => {
  try {
    if (req.user.role !== 'admin') {
      return res.status(403).json({ success: false, message: 'Admin access required' });
    }
    const workspace = await Workspace.findById(req.params.id);
    if (!workspace) {
      return res.status(404).json({ success: false, message: 'Workspace not found' });
    }
    const { password } = req.body;
    if (!password?.trim()) {
      return res.status(400).json({ success: false, message: 'Password is required' });
    }

    workspace.lockPassword = password.trim();
    await workspace.save();

    req.io.emit('workspace:lock-changed', { id: req.params.id, isLocked: true });
    res.json({ success: true, data: { lockPassword: workspace.lockPassword, isLocked: true } });
  } catch (error) {
    next(error);
  }
};

exports.removeLock = async (req, res, next) => {
  try {
    if (req.user.role !== 'admin') {
      return res.status(403).json({ success: false, message: 'Admin access required' });
    }
    const workspace = await Workspace.findById(req.params.id);
    if (!workspace) {
      return res.status(404).json({ success: false, message: 'Workspace not found' });
    }

    workspace.lockPassword = null;
    await workspace.save();

    req.io.emit('workspace:lock-changed', { id: req.params.id, isLocked: false });
    res.json({ success: true, data: { isLocked: false } });
  } catch (error) {
    next(error);
  }
};

exports.getLock = async (req, res, next) => {
  try {
    if (req.user.role !== 'admin') {
      return res.status(403).json({ success: false, message: 'Admin access required' });
    }
    const workspace = await Workspace.findById(req.params.id).select('lockPassword').lean();
    if (!workspace) {
      return res.status(404).json({ success: false, message: 'Workspace not found' });
    }
    res.json({ success: true, data: { lockPassword: workspace.lockPassword } });
  } catch (error) {
    next(error);
  }
};

exports.verifyLock = async (req, res, next) => {
  try {
    const workspace = await Workspace.findById(req.params.id).select('lockPassword').lean();
    if (!workspace) {
      return res.status(404).json({ success: false, message: 'Workspace not found' });
    }
    if (!workspace.lockPassword) {
      return res.json({ success: true });
    }
    const { password } = req.body;
    if (password !== workspace.lockPassword) {
      return res.status(401).json({ success: false, message: 'Incorrect password' });
    }
    res.json({ success: true });
  } catch (error) {
    next(error);
  }
};
