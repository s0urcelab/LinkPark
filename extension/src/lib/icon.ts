const ICON_PX = 128
const MAX_BYTES = 4 << 20

/** Fits an uploaded image into a square PNG data URL for the toolbar icon. */
export function rasterizeIcon(file: File): Promise<string> {
  if (!file.type.startsWith('image/')) return Promise.reject(new Error('请选择图片文件'))
  if (file.size > MAX_BYTES) return Promise.reject(new Error('图片不能超过 4 MB'))
  const url = URL.createObjectURL(file)
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.onload = () => {
      URL.revokeObjectURL(url)
      const w = img.naturalWidth
      const h = img.naturalHeight
      if (!w || !h) {
        reject(new Error('无法读取这张图片'))
        return
      }
      const canvas = document.createElement('canvas')
      canvas.width = ICON_PX
      canvas.height = ICON_PX
      const ctx = canvas.getContext('2d')
      if (!ctx) {
        reject(new Error('无法处理图片'))
        return
      }
      const scale = Math.min(ICON_PX / w, ICON_PX / h)
      const dw = w * scale
      const dh = h * scale
      ctx.drawImage(img, (ICON_PX - dw) / 2, (ICON_PX - dh) / 2, dw, dh)
      resolve(canvas.toDataURL('image/png'))
    }
    img.onerror = () => {
      URL.revokeObjectURL(url)
      reject(new Error('无法读取这张图片'))
    }
    img.src = url
  })
}
