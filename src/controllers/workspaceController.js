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

    const data = workspaces.map((w) => ({ ...w, clipCount: countMap[String(w._id)] || 0 }));
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
    if (workspace.owner.toString() !== req.user._id.toString()) {
      return res.status(403).json({ success: false, message: 'Only the creator can rename this workspace' });
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
    if (workspace.owner.toString() !== req.user._id.toString()) {
      return res.status(403).json({ success: false, message: 'Only the creator can delete this workspace' });
    }

    await Clip.updateMany({ workspace: workspace._id }, { workspace: null });
    await workspace.deleteOne();

    req.io.emit('workspace:deleted', { id: req.params.id });
    res.json({ success: true, message: 'Workspace deleted' });
  } catch (error) {
    next(error);
  }
};
