const Resource = require('../models/Resource');

const MAX_IMAGE_BYTES = 3 * 1024 * 1024; // 3 MB base64

exports.getResources = async (req, res) => {
  try {
    const filter = {};
    if (req.query.workspace) filter.workspace = req.query.workspace;
    const resources = await Resource.find(filter).sort({ createdAt: -1 }).lean();
    res.json({ success: true, data: resources });
  } catch {
    res.status(500).json({ success: false, message: 'Server error' });
  }
};

exports.createResource = async (req, res) => {
  try {
    const { type, name, content, workspaceId } = req.body;
    if (!type || !content) {
      return res.status(400).json({ success: false, message: 'type and content are required' });
    }
    if (!['image', 'text'].includes(type)) {
      return res.status(400).json({ success: false, message: 'Invalid type' });
    }
    if (type === 'image' && content.length > MAX_IMAGE_BYTES) {
      return res.status(400).json({ success: false, message: 'Image too large (max 3 MB)' });
    }
    const resource = await Resource.create({
      type,
      name:       (name || '').trim() || (type === 'image' ? 'Image' : 'Text'),
      content,
      workspace:  workspaceId || null,
      author:     req.user._id,
      authorName: req.user.username,
    });
    req.io.emit('resource:new', { resource });
    res.status(201).json({ success: true, data: resource });
  } catch {
    res.status(500).json({ success: false, message: 'Server error' });
  }
};

exports.deleteResource = async (req, res) => {
  try {
    const resource = await Resource.findById(req.params.id);
    if (!resource) return res.status(404).json({ success: false, message: 'Not found' });
    const isAdmin  = req.user.role === 'admin';
    const isAuthor = resource.author.toString() === req.user._id.toString();
    if (!isAdmin && !isAuthor) {
      return res.status(403).json({ success: false, message: 'Forbidden' });
    }
    await resource.deleteOne();
    req.io.emit('resource:deleted', { id: req.params.id });
    res.json({ success: true });
  } catch {
    res.status(500).json({ success: false, message: 'Server error' });
  }
};
