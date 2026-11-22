import sharp from 'sharp';

const escapeXml = text => text.replace(/[<>&"']/g, char => ({
  '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;', "'": '&apos;',
})[char]);
const clip = (text, width) => {
  const chars = [...text];
  return escapeXml(chars.length > width ? `${chars.slice(0, width - 1).join('')}…` : text);
};

export function renderDeckViewKey(key, control, phase = 0) {
  const { width, height } = control.pixelSize;
  if (!key) return Buffer.alloc(width * height * 3);
  const { title, subtitle, color, icon } = key;
  const spinner = icon === 'spinner' ? `<g transform="rotate(${phase * 45} 36 16)">
    <circle cx="36" cy="16" r="7" fill="none" stroke="#ffffff" stroke-opacity=".26" stroke-width="2"/>
    <path d="M 36,9 A 7,7 0 0 1 43,16" fill="none" stroke="#ffffff" stroke-width="2" stroke-linecap="round"/>
  </g>` : '';
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 72 72" preserveAspectRatio="none">
    <rect x="0" y="0" width="72" height="72" fill="${color}"/>${spinner}
    <text x="36" y="${subtitle || spinner ? 40 : 44}" text-anchor="middle" font-family="sans-serif" font-weight="bold" font-size="10" fill="white">${clip(title, 10)}</text>
    ${subtitle ? `<text x="36" y="55" text-anchor="middle" font-family="sans-serif" font-size="8" fill="white">${clip(subtitle, 16)}</text>` : ''}
  </svg>`;
  return sharp(Buffer.from(svg)).removeAlpha().raw().toBuffer();
}
