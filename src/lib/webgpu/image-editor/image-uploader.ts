// src/lib/webgpu/image-editor/image-uploader.ts

export function createFileInput(onBitmap: (bmp: ImageBitmap, name: string) => void): HTMLInputElement {
  const input = document.createElement('input');
  input.type   = 'file';
  input.accept = 'image/png,image/jpeg,image/webp,image/svg+xml';
  input.style.display = 'none';
  input.addEventListener('change', async () => {
    const file = input.files?.[0];
    if (!file) return;
    const bmp = await createImageBitmap(file);
    onBitmap(bmp, file.name);
    input.value = '';  // allow re-selecting same file
  });
  return input;
}

export function attachDropZone(
  el: HTMLElement,
  onBitmap: (bmp: ImageBitmap, name: string) => void,
): () => void {
  const onDragOver = (e: DragEvent) => { e.preventDefault(); el.style.outline = '2px solid var(--accent)'; };
  const onDragLeave = () => { el.style.outline = ''; };
  const onDrop = async (e: DragEvent) => {
    e.preventDefault();
    el.style.outline = '';
    const file = e.dataTransfer?.files[0];
    if (!file || !file.type.startsWith('image/')) return;
    const bmp = await createImageBitmap(file);
    onBitmap(bmp, file.name);
  };
  el.addEventListener('dragover',  onDragOver);
  el.addEventListener('dragleave', onDragLeave);
  el.addEventListener('drop',      onDrop);
  return () => {
    el.removeEventListener('dragover',  onDragOver);
    el.removeEventListener('dragleave', onDragLeave);
    el.removeEventListener('drop',      onDrop);
  };
}
