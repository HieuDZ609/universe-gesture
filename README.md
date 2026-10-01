# Universe — Vũ trụ hạt điều khiển bằng tay

Một vũ trụ 3D gồm **120.000 hạt nhiều màu**, điều khiển bằng chính đôi tay của bạn
qua camera máy tính. Không cần chuột.

## Cử chỉ

| Cử chỉ | Hành động |
|---|---|
| **1 tay xòe ra** (≥ 4/5 ngón + lòng bàn tay phẳng) | **Xoay 360°** — di chuyển tay để xoay, không có góc chết |
| **2 tay xòe ra** | **Zoom** — kéo 2 tay ra xa = zoom vào (camera tiến vào vũ trụ), kéo lại gần = zoom xa (camera lùi ra) |
| Chuột (dự phòng) | Kéo để xoay, lăn để zoom |

**Cơ chế "zoom từ khi đưa vào màn hình":** khoảnh khắc cả 2 tay xòe được nhận diện là
mốc tham chiếu (baseline). Mọi cử động xoè ra / kéo lại sau đó được so với đúng mốc
đó, nên bạn đưa tay vào màn hình ở bất kỳ khoảng cách nào cũng đều đúng.
Khoảng cách giữa 2 lòng bàn tay tăng → `spread > 0` → camera **tiến vào**;
giảm → camera **lùi ra**. Di chuyển theo chiều ngang của cặp tay còn tạo thêm thành
phần vector, xoay nhẹ góc nhìn theo hướng tay đi.

## Chạy

```bash
npm install      # tự tải model nhận diện tay + WASM vào public/
npm run dev      # http://localhost:5173
```

Bấm **“Bật camera & bắt đầu”** và cho phép trình duyệt dùng camera.

> Camera cần ngữ cảnh an toàn: `localhost` hoặc HTTPS.

### Build & test

```bash
npm run build    # xuất ra dist/
npm run preview  # chạy thử bản build
npm test         # 48 test logic + gesture, không cần camera
```

## Phím tắt

| Phím | Tác dụng |
|---|---|
| `G` | Bật/tắt nhận diện tay (dùng chuột khi tắt) |
| `C` | Bật/tắt camera — giải phóng thiết bị |
| `H` | Ẩn/hiện HUD |
| `R` | Đặt lại góc nhìn + đặt lại mốc zoom |
| `F` | Toàn màn hình |

## Vũ trụ

Ba lớp hạt cùng tồn tại, không có giai đoạn nở ra nào — hình cầu luôn ở chính giữa:

- **Lõi (~74.000 hạt)** — vỏ cầu mỏng tại bán kính 32, màu vàng → cam → trắng. Đây là
  lớp được *shade* thật: diffuse có wrap, viền sáng (limb), tâm nóng. Nửa gần của
  vỏ che nửa xa nên nó có bề mặt chứ không phải một đám sáng phẳng.
- **Bụi (~31.000 hạt)** — 3 cánh xoáy + 26 cụm, bán kính 40–78, additive. Lớp mờ
  làm mềm chỗ tiếp giáp giữa cầu và các lớp ngoài.
- **Sao (~14.000 hạt)** — bán kính 85–190, mỗi sao có **quỹ đạo riêng**: trục nghiêng
  riêng, tốc độ riêng (sao gần quay nhanh hơn sao xa, kiểu Kepler), mặt phẳng quỹ đạo
  tiến dần (precession). Toàn bộ phép quay tính trong vertex shader nên chi phí CPU
  là **một biến uniform mỗi khung hình**, không phụ thuộc số sao.
- Chất lượng tự chọn theo máy (60k / 120k / 180k hạt).

## Kiến trúc

```
src/
  main.js                  vòng lặp render, nối input tay/chuột, bật/tắt camera
  core/App.js              renderer, scene, camera, resize, chọn chất lượng
  universe/
    UniverseGeometry.js    sinh 3 lớp hạt + quỹ đạo từng sao + màu
    UniverseMaterial.js    shader: diffuse/limb/centre cho lõi, orbit cho sao
    Universe.js            3 Points, thứ tự render, drift
  hands/
    HandTracker.js         MediaPipe HandLandmarker (VIDEO), camera, trạng thái
    LandmarkUtils.js       hình học bàn tay: độ mở ngón, phẳng lòng, khoảng cách
  gestures/
    GestureMapper.js       ánh xạ trạng thái tay → xoay / zoom, arbitration hold-time
  camera/
    CameraController.js    orbit 360° không góc chết + dolly có clamp
  ui/
    HUD.js                 mode, số đo, thanh ngón tay, toast, nút camera
    HandOverlay.js         vẽ bộ xương tay lên preview camera
tests/
  logic.test.mjs           nhận diện cử chỉ, orbit, dolly, hình học 3 lớp
  gestures.test.mjs        chuỗi gesture thật -> hành vi camera
scripts/
  fetch-assets.mjs         tải model + copy WASM (chạy qua postinstall)
```

## Ghi chú kỹ thuật

- **Không góc chết:** yaw lưu dạng *unwrapped* và damping nhận biết góc, nên qua mốc
  ±π camera không giật ngược. Pitch chặn ở 6°–174° để tránh lật trục.
- **Chống nhiễu:** cử chỉ phải giữ liên tục 110ms mới chuyển chế độ; có deadzone ở
  giữa khoảng zoom; landmark được chuẩn hoá theo kích thước lòng bàn tay nên không
  phụ thuộc bạn đứng gần hay xa máy.
- **Thứ tự vẽ:** lõi viết depth (`depthWrite`) nên bụi và sao vẽ sau bị che đúng khi
  nằm sau cầu, còn bụi ở phía trước vẫn cộng sáng lên. Alpha test ở lõi loại bỏ phần
  rìa mờ để chúng không ghi depth sai, nhờ đó viền cầu sắc nét.
- **Hiệu năng:** nhận diện tay chạy ở 30fps tách khỏi vòng lặp render; HUD cập nhật ở
  ~20Hz; số hạt tự giảm trên máy yếu.
- **Fallback:** nếu WASM/model cục bộ lỗi, app tự thử CDN; nếu camera bị chặn hoặc
  bạn tắt camera, vẫn chơi được bằng chuột.

## Privacy

- **Ảnh camera không rời khỏi máy bạn.** Nhận diện tay chạy hoàn toàn cục bộ bằng
  WebAssembly (MediaPipe HandLandmarker). Không khung hình nào được tải lên, ghi log,
  hay gửi đi đâu cả.
- **Không telemetry, không analytics, không cookie, không `localStorage`.** Đóng tab
  là không còn gì.
- **Không xin microphone** — `getUserMedia` được gọi với `audio: false`.
- **Không có backend.** Một bản deploy chỉ là các file tĩnh. Chúng ta chỉ tải model +
  WASM một lần lúc khởi động, và bản thân hai file đó đã được copy từ `node_modules`
  lúc `npm install` nên chạy từ chính origin của bạn.
- **Tắt camera bất cứ lúc nào:** nút `TẮT` trên khung preview, hoặc phím `C`. Mọi track
  đều được `stop()` thật nên đèn báo ghi hình của trình duyệt tắt luôn.

Xem [SECURITY.md](SECURITY.md) để biết cách báo lỗ hổng và mô hình đe doá.

## Deploying

`npm run build` cho ra `dist/` — thư mục tĩnh, deploy ở đâu cũng được (GitHub Pages,
Netlify, Vercel, Cloudflare Pages, hay bất kỳ web server nào).

> **Bắt buộc HTTPS.** Camera chỉ hoạt động trên ngữ cảnh an toàn: `localhost` hoặc
> HTTPS. Deploy bằng HTTP thì `getUserMedia` sẽ bị chặn.

Cần thêm header sau ở host (không làm được bằng `<meta>` — xem giải thích trong
`index.html`):

```
Content-Security-Policy: frame-ancestors 'none'
X-Content-Type-Options: nosniff
Referrer-Policy: no-referrer
Permissions-Policy: camera=(self)
```

- **Netlify** — tạo `public/_headers` với nội dung trên.
- **Vercel** — thêm `headers` vào `vercel.json`.
- **Cloudflare Pages** — tạo file `_headers` ở thư mục gốc dự án.
- **GitHub Pages** — không hỗ trợ custom header; chỉ dùng được CSP trong `index.html`.

Nhớ bật **asset optimization** cho lần build đầu, vì lần clone đầu tiên sẽ phải tải
42MB model + WASM từ CDN của bạn. Sau đó trình duyệt cache lại.

## Credits & License

Code của dự án: **MIT** — xem [LICENSE](LICENSE).

Thành phần bên thứ ba giữ giấy phép riêng, không nằm trong MIT:

| Thành phần | Giấy phép | Vai trò |
|---|---|---|
| [Three.js](https://threejs.org) | MIT | render 3D, particle system |
| [MediaPipe Tasks Vision](https://ai.google.dev/edge/mediapipe) | Apache-2.0 | nhận diện tay + file WASM |
| [HandLandmarker model](https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task) | Apache-2.0 | trọng số mô hình, tải lúc `npm install` |
| [Vite](https://vite.dev) | MIT | dev server + build |

Model và file WASM **không** commit vào repo (42MB). Script `postinstall` tải lại
giúp bạn, nên clone về là chạy được ngay.
