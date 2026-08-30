export function getScale(element: HTMLElement) {
  return {
    x: Number.parseFloat(element.dataset.scaleX ?? "1"),
    y: Number.parseFloat(element.dataset.scaleY ?? "1"),
  };
}

export function setScale(element: HTMLElement, scaleX: number, scaleY: number) {
  element.dataset.scaleX = String(scaleX);
  element.dataset.scaleY = String(scaleY);
}

export function getRotation(element: HTMLElement) {
  return Number.parseFloat(element.dataset.rotation ?? "0");
}

export function setRotation(element: HTMLElement, degrees: number) {
  element.dataset.rotation = String(degrees);
}

export function applyNodeTransform(element: HTMLElement) {
  const { x, y } = getScale(element);
  element.style.transform = `rotate(${getRotation(element)}deg)`;
  const content = element.querySelector<HTMLElement>(":scope > .element-content");
  if (content) {
    content.style.transformOrigin = "center center";
    content.style.transform = `scaleX(${x}) scaleY(${y})`;
  }
}
