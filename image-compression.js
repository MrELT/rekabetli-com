(function initImageCompression() {
  function loadImageFromFile(file) {
    return new Promise((resolve, reject) => {
      const objectUrl = URL.createObjectURL(file);
      const img = new Image();
      img.onload = () => {
        URL.revokeObjectURL(objectUrl);
        resolve(img);
      };
      img.onerror = () => {
        URL.revokeObjectURL(objectUrl);
        reject(new Error("Gorsel okunamadi."));
      };
      img.src = objectUrl;
    });
  }

  function canvasToBlob(canvas, mimeType, quality) {
    return new Promise((resolve, reject) => {
      canvas.toBlob(
        (blob) => {
          if (!blob) {
            reject(new Error("Gorsel sikistirma basarisiz."));
            return;
          }
          resolve(blob);
        },
        mimeType,
        quality
      );
    });
  }

  async function compressImageFile(file, options = {}) {
    const maxBytes = Number(options.maxBytes) || 5 * 1024 * 1024;
    const maxDimension = Number(options.maxDimension) || 1600;
    const outputType = options.outputType || "image/webp";
    const outputName = options.outputName || "optimized.webp";

    if (!(file instanceof File)) return file;
    if (file.size <= maxBytes) return file;

    const image = await loadImageFromFile(file);
    let width = image.naturalWidth || image.width;
    let height = image.naturalHeight || image.height;

    if (!width || !height) return file;

    const scale = Math.min(1, maxDimension / Math.max(width, height));
    width = Math.max(1, Math.round(width * scale));
    height = Math.max(1, Math.round(height * scale));

    const canvas = document.createElement("canvas");
    const ctx = canvas.getContext("2d", { alpha: false });
    if (!ctx) return file;

    canvas.width = width;
    canvas.height = height;
    ctx.drawImage(image, 0, 0, width, height);

    const qualitySteps = [0.9, 0.82, 0.74, 0.66, 0.58, 0.5];

    for (const quality of qualitySteps) {
      const blob = await canvasToBlob(canvas, outputType, quality);
      if (blob.size <= maxBytes) {
        return new File([blob], outputName, { type: outputType, lastModified: Date.now() });
      }
    }

    const lastBlob = await canvasToBlob(canvas, outputType, 0.45);
    return new File([lastBlob], outputName, { type: outputType, lastModified: Date.now() });
  }

  window.RekabetliImageCompression = {
    compressImageFile,
  };
})();
