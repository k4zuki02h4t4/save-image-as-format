let lastElement = null;

// Canvasが実際に何か描画されているか物理的に判定する
function isCanvasNotEmpty(canvas) {
	// 1. サイズ判定 (画面サイズに近い場合は画像とみなす)
	if (canvas.width > 10 && canvas.height > 10) return true;

	try {
		const ctx = canvas.getContext('2d');
		if (!ctx) return true; // WebGL等の場合は画像ありと推定

		// 中心の1ピクセルを取得して透明度をチェック
		const pixel = ctx.getImageData(canvas.width / 2, canvas.height / 2, 1, 1).data;
		return pixel[3] > 0; // Alphaが0より大きければ何か描かれている
	} catch (e) {
		// CORSエラー(汚染)が出る場合は、外部画像が描画されている証拠なので true
		return true;
	}
}

window.addEventListener('mousedown', (event) => {
	if (event.button === 2) { // 右クリック
		lastElement = event.target;

		const isNormalImage = lastElement instanceof HTMLImageElement;
		let isCanvasWithImage = false;

		if (lastElement instanceof HTMLCanvasElement) {
			// 属性がある、または物理チェックで中身がある場合
			isCanvasWithImage = (lastElement.getAttribute('data-has-image') === 'true') ||
				isCanvasNotEmpty(lastElement);
		}

		if (chrome.runtime?.id) {
			chrome.runtime.sendMessage({
				type: 'TOGGLE_MENU',
				show: isNormalImage || isCanvasWithImage
			}).catch(() => {});
		}
	}
}, true);

// データ要求への応答
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
	if (request.type === 'GET_IMAGE_DATA') {
		if (lastElement instanceof HTMLCanvasElement) {
			try {
				// Canvasの内容をDataURL化
				sendResponse({ srcUrl: lastElement.toDataURL('image/png') });
			} catch (e) {
				sendResponse({ srcUrl: null });
			}
		} else if (lastElement instanceof HTMLImageElement) {
			sendResponse({ srcUrl: lastElement.src });
		}
	}
	return true;
});