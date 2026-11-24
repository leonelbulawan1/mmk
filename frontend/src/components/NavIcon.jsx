// The app's one icon set: Bootstrap Icons (https://icons.getbootstrap.com), imported per icon so only these are bundled.
// Decorative by default: the link or button next to it carries the text.
import i0 from 'bootstrap-icons/icons/grid.svg?raw'
import i1 from 'bootstrap-icons/icons/book.svg?raw'
import i2 from 'bootstrap-icons/icons/pencil-square.svg?raw'
import i3 from 'bootstrap-icons/icons/people.svg?raw'
import i4 from 'bootstrap-icons/icons/file-earmark-text.svg?raw'
import i5 from 'bootstrap-icons/icons/shield-check.svg?raw'
import i6 from 'bootstrap-icons/icons/chat-dots.svg?raw'
import i7 from 'bootstrap-icons/icons/link-45deg.svg?raw'
import i8 from 'bootstrap-icons/icons/sliders.svg?raw'
import i9 from 'bootstrap-icons/icons/house.svg?raw'
import i10 from 'bootstrap-icons/icons/envelope.svg?raw'
import i11 from 'bootstrap-icons/icons/list.svg?raw'
import i12 from 'bootstrap-icons/icons/x-lg.svg?raw'
import i13 from 'bootstrap-icons/icons/layout-sidebar-inset.svg?raw'
import i14 from 'bootstrap-icons/icons/layout-sidebar.svg?raw'
import i15 from 'bootstrap-icons/icons/box-arrow-left.svg?raw'
import i16 from 'bootstrap-icons/icons/send.svg?raw'
import i17 from 'bootstrap-icons/icons/three-dots-vertical.svg?raw'
import i18 from 'bootstrap-icons/icons/pencil.svg?raw'
import i19 from 'bootstrap-icons/icons/trash3.svg?raw'
import i20 from 'bootstrap-icons/icons/fullscreen.svg?raw'
import i21 from 'bootstrap-icons/icons/plus-lg.svg?raw'
import i22 from 'bootstrap-icons/icons/search.svg?raw'
import i23 from 'bootstrap-icons/icons/chevron-down.svg?raw'
import i24 from 'bootstrap-icons/icons/chevron-left.svg?raw'
import i25 from 'bootstrap-icons/icons/lock.svg?raw'
import i26 from 'bootstrap-icons/icons/person.svg?raw'
import i27 from 'bootstrap-icons/icons/key.svg?raw'
import i28 from 'bootstrap-icons/icons/eye.svg?raw'
import i29 from 'bootstrap-icons/icons/eye-slash.svg?raw'
import i30 from 'bootstrap-icons/icons/check-circle.svg?raw'
import i31 from 'bootstrap-icons/icons/exclamation-circle.svg?raw'
import i32 from 'bootstrap-icons/icons/info-circle.svg?raw'
import i33 from 'bootstrap-icons/icons/exclamation-triangle.svg?raw'

import i90 from 'bootstrap-icons/icons/arrow-right.svg?raw'
import i91 from 'bootstrap-icons/icons/arrow-left.svg?raw'
import i92 from 'bootstrap-icons/icons/check-lg.svg?raw'
const SVG = {
  'dashboard': i0,
  'entries': i1,
  'write': i2,
  'people': i3,
  'policy': i4,
  'access': i5,
  'assistant': i6,
  'vault': i7,
  'settings': i8,
  'home': i9,
  'letters': i10,
  'menu': i11,
  'close': i12,
  'collapse': i13,
  'expand': i14,
  'signout': i15,
  'send': i16,
  'more': i17,
  'edit': i18,
  'trash': i19,
  'focus': i20,
  'plus': i21,
  'search': i22,
  'chevron-down': i23,
  'chevron-left': i24,
  'lock': i25,
  'person': i26,
  'key': i27,
  'eye': i28,
  'eye-slash': i29,
  'check-circle': i30,
  'error': i31,
  'info': i32,
  'warning': i33,
  'arrow-right': i90,
  'arrow-left': i91,
  'check': i92,
}
// The paths inside each file (the outer <svg> is drawn below, so size and class stay in one place).
const inner = (raw) => raw.replace(/^[\s\S]*?<svg[^>]*>/, '').replace(/<\/svg>\s*$/, '')
const PATHS = Object.fromEntries(Object.entries(SVG).map(([k, v]) => [k, inner(v)]))

export default function NavIcon({ name, size = 18, className = '', label }) {
  return (
    <svg viewBox="0 0 16 16" width={size} height={size} fill="currentColor" className={`bi shrink-0 ${className}`}
      {...(label ? { role: 'img', 'aria-label': label } : { 'aria-hidden': true })}
      dangerouslySetInnerHTML={{ __html: PATHS[name] || '' }} />
  )
}
export { NavIcon as Icon }
