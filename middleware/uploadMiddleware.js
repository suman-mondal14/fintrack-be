const multer = require('multer');

// Configure multer to store files entirely in memory (RAM buffer)
const storage = multer.memoryStorage();

// Accept only standard image files (PNG, JPG, JPEG, WEBP)
const fileFilter = (req, file, cb) => {
  const allowedMimeTypes = ['image/jpeg', 'image/png', 'image/jpg', 'image/webp'];

  if (allowedMimeTypes.includes(file.mimetype)) {
    cb(null, true);
  } else {
    cb(new Error('Invalid file type. Only JPG, JPEG, PNG, and WEBP image screenshots are allowed.'), false);
  }
};

const upload = multer({
  storage,
  fileFilter,
  limits: {
    fileSize: 10 * 1024 * 1024 // 10MB maximum limit
  }
});

module.exports = upload;

