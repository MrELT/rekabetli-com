(function initImageUploadLimit() {
  const DAILY_LIMIT = 5;
  const LIMIT_ERROR_CODE = "DAILY_IMAGE_UPLOAD_LIMIT";

  class DailyImageUploadLimitError extends Error {
    constructor(usedCount, maxCount) {
      super(
        `Günlük görsel yükleme limitine ulaştınız (${usedCount}/${maxCount}). Yarın tekrar deneyebilirsiniz.`
      );
      this.name = "DailyImageUploadLimitError";
      this.code = LIMIT_ERROR_CODE;
      this.usedCount = usedCount;
      this.maxCount = maxCount;
    }
  }

  function getClient() {
    return window.getSupabase?.() || window.sb || null;
  }

  /**
   * Yüklemeden önce çağırın; limit doluysa hata fırlatır, aksi halde kotayı 1 azaltır.
   */
  async function consumeUploadSlot(supabase, { bucket, path } = {}) {
    const client = supabase || getClient();
    if (!client) {
      throw new Error("Supabase bağlantısı bulunamadı.");
    }

    const { data, error } = await client.rpc("consume_daily_image_upload", {
      p_bucket: bucket ?? null,
      p_storage_path: path ?? null,
    });

    if (error) {
      console.error("consume_daily_image_upload error:", error.message);
      throw error;
    }

    if (!data?.allowed) {
      throw new DailyImageUploadLimitError(
        Number(data.used_count) || DAILY_LIMIT,
        Number(data.max_count) || DAILY_LIMIT
      );
    }

    return data;
  }

  function isLimitError(error) {
    return error?.code === LIMIT_ERROR_CODE || error?.name === "DailyImageUploadLimitError";
  }

  function getLimitMessage(error) {
    if (isLimitError(error)) return error.message;
    return `Günlük en fazla ${DAILY_LIMIT} görsel yükleyebilirsiniz.`;
  }

  window.RekabetliImageUploadLimit = {
    DAILY_LIMIT,
    LIMIT_ERROR_CODE,
    DailyImageUploadLimitError,
    consumeUploadSlot,
    isLimitError,
    getLimitMessage,
  };
})();
