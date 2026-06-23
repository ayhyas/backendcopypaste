const Clip = require('../models/Clip');

const MAX_CLIP_BYTES = 12 * 1024 * 1024; // 12 MB (covers ~9 MB binary files stored as base64)

exports.getClips = async (req, res, next) => {
  try {
    const page = Math.max(1, parseInt(req.query.page) || 1);
    const limit = Math.min(100, Math.max(1, parseInt(req.query.limit) || 50));
    const skip = (page - 1) * limit;

    const [clips, total] = await Promise.all([
      Clip.find().sort({ createdAt: -1 }).skip(skip).limit(limit).lean(),
      Clip.countDocuments(),
    ]);

    res.json({
      success: true,
      data: clips,
      pagination: {
        page,
        limit,
        total,
        pages: Math.ceil(total / limit),
        hasMore: skip + clips.length < total,
      },
    });
  } catch (error) {
    next(error);
  }
};

exports.createClip = async (req, res, next) => {
  try {
    const { content, type, language, fileName, mimeType, fileSize } = req.body;

    if (!content || (type !== 'file' && content.trim() === '')) {
      return res.status(400).json({ success: false, message: 'Content cannot be empty' });
    }

    if (Buffer.byteLength(content, 'utf8') > MAX_CLIP_BYTES) {
      return res.status(413).json({ success: false, message: 'Content exceeds the 12 MB limit' });
    }

    const clip = await Clip.create({
      content,
      type: type || 'text',
      language: language || null,
      fileName: fileName || null,
      mimeType: mimeType || null,
      fileSize: fileSize || null,
      author: req.user._id,
      authorName: req.user.username,
    });

    req.io.emit('clip:new', { data: clip });

    res.status(201).json({ success: true, data: clip });
  } catch (error) {
    next(error);
  }
};

exports.deleteClip = async (req, res, next) => {
  try {
    const clip = await Clip.findById(req.params.id);

    if (!clip) {
      return res.status(404).json({ success: false, message: 'Clip not found' });
    }

    if (clip.author.toString() !== req.user._id.toString()) {
      return res.status(403).json({ success: false, message: 'You can only delete your own clips' });
    }

    await clip.deleteOne();

    req.io.emit('clip:deleted', { id: req.params.id });

    res.json({ success: true, message: 'Clip deleted successfully' });
  } catch (error) {
    next(error);
  }
};
