const Resource = require('../models/Resource');
const { checkWorkspaceAccess } = require('../utils/wsToken');

const MAX_IMAGE_BYTES = 3 * 1024 * 1024; // 3 MB base64

exports.getResources = async (req, res, next) => {
  try {
    const deny = await checkWorkspaceAccess(req, req.query.workspace);
    if (deny) return res.status(deny.status).json({ success: false, message: deny.message, code: deny.code });

    const filter = {};
    if (req.query.workspace) filter.workspace = req.query.workspace;
    const resources = await Resource.find(filter).sort({ createdAt: -1 }).lean();
    res.json({ success: true, data: resources });
  } catch (err) { next(err); }
};

exports.createResource = async (req, res, next) => {
  try {
    const { type, name, content, workspaceId } = req.body;

    const deny = await checkWorkspaceAccess(req, workspaceId);
    if (deny) return res.status(deny.status).json({ success: false, message: deny.message, code: deny.code });

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
    const room = workspaceId ? 'ws:' + workspaceId : null;
    if (room) req.io.to(room).emit('resource:new', { resource });
    else req.io.emit('resource:new', { resource });
    res.status(201).json({ success: true, data: resource });
  } catch (err) { next(err); }
};

exports.deleteResource = async (req, res, next) => {
  try {
    const resource = await Resource.findById(req.params.id);
    if (!resource) return res.status(404).json({ success: false, message: 'Not found' });
    const isAdmin  = req.user.role === 'admin';
    const isAuthor = resource.author.toString() === req.user._id.toString();
    if (!isAdmin && !isAuthor) {
      return res.status(403).json({ success: false, message: 'Forbidden' });
    }
    const room = resource.workspace ? 'ws:' + resource.workspace : null;
    await resource.deleteOne();
    if (room) req.io.to(room).emit('resource:deleted', { id: req.params.id });
    else req.io.emit('resource:deleted', { id: req.params.id });
    res.json({ success: true });
  } catch (err) { next(err); }
};
