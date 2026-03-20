(function() {
	const ATTRIBUTE_NAME = 'data-has-image';

	// 1. getContext 自体をフックして、取得された瞬間にマークする
	const orgGetContext = HTMLCanvasElement.prototype.getContext;
	HTMLCanvasElement.prototype.getContext = function() {
		this.setAttribute(ATTRIBUTE_NAME, 'true'); // 取得されたら即マーク
		return orgGetContext.apply(this, arguments);
	};

	// 2. 既存の描画メソッドも念のため維持
	const mark = (ctx) => {
		if (ctx && ctx.canvas && !ctx.canvas.hasAttribute(ATTRIBUTE_NAME)) {
			ctx.canvas.setAttribute(ATTRIBUTE_NAME, 'true');
		}
	};

	const org2D = CanvasRenderingContext2D.prototype;
	const drawMethods = [
		'drawImage',
		'putImageData',
		'fillRect',
		'fill',
		'stroke',
		'rect'
	];
	drawMethods.forEach(m => {
		const original = org2D[m];
		org2D[m] = function() {
			mark(this);
			return original.apply(this, arguments);
		};
	});
})();