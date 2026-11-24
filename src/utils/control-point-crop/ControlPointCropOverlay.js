import * as THREE from '../../../libs/three.js/build/three.module.js';

const svgNamespace = 'http://www.w3.org/2000/svg';
const lowerColor = '#ada3ff';
const upperColor = '#84fbb0';

const overlayStyles = `
.potree-control-point-crop,
.potree-control-point-crop > svg {
	position: absolute;
	inset: 0;
	width: 100%;
	height: 100%;
	pointer-events: none;
}

.potree-control-point-crop { z-index: 6; }
.potree-control-point-crop > svg > path {
	stroke-width: 2;
	stroke-linecap: round;
	stroke-linejoin: round;
	opacity: 0.95;
}

.potree-control-point-crop > button {
	position: absolute;
	display: grid;
	place-items: center;
	width: 30px;
	height: 30px;
	padding: 0;
	border: 0;
	border-radius: 50%;
	background: rgba(0, 0, 0, 0.5);
	color: white;
	transform: translate(-50%, -50%);
	pointer-events: auto;
	cursor: pointer;
}

.potree-control-point-crop > button > span {
	display: grid;
	place-items: center;
	width: 22.5px;
	height: 22.5px;
	border-radius: 50%;
	font: 600 12px/14px system-ui, sans-serif;
}

.potree-control-point-crop > button[aria-pressed="true"] { background: rgba(255, 255, 255, 0.3); }
.potree-control-point-crop > button[aria-pressed="true"] > span { background: #a78bfa; }
.potree-control-point-crop > button:focus-visible { outline: 2px solid white; outline-offset: 3px; }
.potree-control-point-crop > [hidden] { display: none; }
.potree-control-point-crop-height {
	position: absolute;
	transform: translateY(-50%);
	font: 600 12px/14px system-ui, sans-serif;
	white-space: nowrap;
	text-shadow: 0 1px 3px rgba(0, 0, 0, 0.7);
}
`;

/** Project world-space vertices to a fixed-width, interactive screen overlay. */
export class ControlPointCropOverlay {
  constructor(viewer) {
    this.viewer = viewer;
    this.document = viewer.renderArea.ownerDocument;
    this.root = this.document.createElement('div');
    this.root.className = 'potree-control-point-crop';
    // Minimal iframe hosts load the script without Potree's GUI stylesheet.
    const styles = this.document.createElement('style');
    styles.textContent = overlayStyles;
    this.root.append(styles);
    this.svg = this.document.createElementNS(svgNamespace, 'svg');
    this.svg.setAttribute('aria-hidden', 'true');
    this.lower = this.createPath(lowerColor);
    this.upper = this.createPath(upperColor);
    this.vertical = this.createPath(upperColor, '6 5');
    this.lowLabel = this.createHeightLabel(lowerColor);
    this.highLabel = this.createHeightLabel(upperColor);
    this.root.prepend(this.svg);
    this.buttons = new Map();
    this.vector = new THREE.Vector3();
    this.render = () => this.updateProjection();
    viewer.renderArea.append(this.root);
    viewer.addEventListener('render.pass.end', this.render);
  }

  createPath(color, dash) {
    const path = this.document.createElementNS(svgNamespace, 'path');
    path.setAttribute('stroke', color);
    path.setAttribute('fill', 'none');
    path.setAttribute('fill-opacity', '0.08');
    if (dash) path.setAttribute('stroke-dasharray', dash);
    this.svg.append(path);
    return path;
  }

  createHeightLabel(color) {
    const label = this.document.createElement('span');
    label.className = 'potree-control-point-crop-height';
    label.style.color = color;
    this.root.append(label);
    return label;
  }

  update(state) {
    this.state = state;
    const ids = new Set(state.points.map(({ id }) => id));
    for (const [id, button] of this.buttons) {
      if (!ids.has(id)) {
        button.remove();
        this.buttons.delete(id);
      }
    }
    for (const { id, label = id, accessibleLabel = label } of state.points) {
      let button = this.buttons.get(id);
      if (!button) {
        button = this.document.createElement('button');
        button.type = 'button';
        const disc = this.document.createElement('span');
        button.append(disc);
        button.addEventListener('pointerdown', event => event.stopPropagation());
        button.addEventListener('mousedown', event => event.stopPropagation());
        button.addEventListener('click', event => {
          event.stopPropagation();
          this.state.onPointToggle?.(id);
        });
        this.root.append(button);
        this.buttons.set(id, button);
      }
      button.firstElementChild.textContent = label;
      button.setAttribute('aria-label', accessibleLabel);
      button.setAttribute('aria-pressed', String(state.selected.has(id)));
    }
    this.lowLabel.textContent = `Z ${state.zMin.toFixed(2)} m`;
    this.highLabel.textContent = `Z ${state.zMax.toFixed(2)} m`;
    this.updateProjection();
  }

  updateProjection() {
    const { points, perimeter, zMin, zMax } = this.state;
    const { clientWidth: width, clientHeight: height } = this.viewer.renderArea;
    const camera = this.viewer.scene.getActiveCamera();
    this.svg.setAttribute('viewBox', `0 0 ${width} ${height}`);
    const project = ({ x, y }, z) => {
      const p = this.vector.set(x, y, z).project(camera);
      return p.z < -1 || p.z > 1 ? null : [(p.x + 1) * width / 2, (1 - p.y) * height / 2];
    };
    const place = (element, point, dx = 0, dy = 0) => {
      element.hidden = !point;
      if (!point) return;
      element.style.left = `${point[0] + dx}px`;
      element.style.top = `${point[1] + dy}px`;
    };
    for (const point of points) place(this.buttons.get(point.id), project(point, zMin));

    // Keep point numbers selectable even when there is no prism to draw.
    const showPrism = perimeter.length >= 3 && zMin < zMax;
    const low = showPrism ? perimeter.map(point => project(point, zMin)) : [];
    const high = showPrism ? perimeter.map(point => project(point, zMax)) : [];
    const path = coordinates => showPrism && coordinates.every(Boolean)
      ? `M${coordinates.map(pair => pair.join(',')).join('L')}Z` : '';
    this.lower.setAttribute('d', path(low));
    this.upper.setAttribute('d', path(high));
    this.lower.setAttribute('fill', lowerColor);
    this.upper.setAttribute('fill', upperColor);
    this.vertical.setAttribute('d',
      low.map((point, index) => point && high[index] ? `M${point}L${high[index]}` : '').join(''));

    // Offset coincident height labels enough to remain legible in a top view.
    const firstLow = low[0];
    const firstHigh = high[0];
    const overlap = firstLow && firstHigh && Math.hypot(firstLow[0] - firstHigh[0], firstLow[1] - firstHigh[1]) < 16;
    place(this.lowLabel, firstLow, 22);
    place(this.highLabel, firstHigh, 22, overlap ? -16 : 0);
  }

  dispose() {
    this.viewer.removeEventListener('render.pass.end', this.render);
    this.root.remove();
  }
}
