const Drawing = require('../models/Drawing');

exports.getDrawings = async (req, res, next) => {
  try {
    const filter = {};
    if (req.query.workspace) filter.workspace = req.query.workspace;
    const drawings = await Drawing.find(filter).sort({ createdAt: -1 }).lean();
    res.json({ success: true, data: drawings });
  } catch (err) { next(err); }
};

exports.createDrawing = async (req, res, next) => {
  try {
    const { title, elements, preview, workspaceId } = req.body;

    if (!elements || !preview) {
      return res.status(400).json({ success: false, message: 'Missing elements or preview' });
    }
    if (preview.length > 2_000_000) {
      return res.status(413).json({ success: false, message: 'Preview image too large' });
    }

    const drawing = await Drawing.create({
      title:      title?.trim() || 'Untitled',
      author:     req.user._id,
      authorName: req.user.username,
      workspace:  workspaceId || null,
      elements,
      preview,
    });

    req.io.emit('drawing:new', { data: drawing });
    res.status(201).json({ success: true, data: drawing });
  } catch (err) { next(err); }
};

exports.deleteDrawing = async (req, res, next) => {
  try {
    const drawing = await Drawing.findById(req.params.id);
    if (!drawing) {
      return res.status(404).json({ success: false, message: 'Drawing not found' });
    }
    if (drawing.author.toString() !== req.user._id.toString() && req.user.role !== 'admin') {
      return res.status(403).json({ success: false, message: 'Not authorised' });
    }

    await drawing.deleteOne();
    req.io.emit('drawing:deleted', { id: req.params.id });
    res.json({ success: true });
  } catch (err) { next(err); }
};
