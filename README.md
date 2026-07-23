# Web Solo frontend

Vue/Vite frontend cho Người–Máy và Máy–Máy. Mọi vị trí máy đều dùng cùng một catalog bot:

- bot Alpha-Beta và Random đã đóng gói trong web, không cần Python;
- binary C++ Stage được gọi qua `server/native_bot_bridge.mjs`.
- giải Máy–Máy tự chia nhóm hạt giống từ Elo tích lũy, ghép loại trực tiếp và đổi bên đi trước;
- Elo, bracket, từng trận và từng nước đi được lưu qua MySQL 8;
- trang Thống kê/Lịch sử đọc projection từ `/api/report` và chỉ dùng seed khi DB lỗi.
- trang Benchmark đối chiếu Elo với chi phí tìm kiếm, drill-down theo workload và chỉ ra
  bottleneck/khuyến nghị có bằng chứng cho từng version.
- trang Stage hiện tại ghi rõ champion, pipeline và feature bật/tắt; trang Thuật toán giải thích
  Minimax/Negamax, Alpha-Beta, evaluator, TT, ordering, PVS, `L_eq` và lineage LUT cho end user.

Benchmark được quản lý theo `bot version -> algorithm profile -> suite -> run -> case`. Dữ liệu thô
và kết luận đã duyệt nằm trong MySQL; các tín hiệu tự động được dựng lại từ dữ liệu đó mỗi lần đọc,
không trộn Elo và tốc độ thành một điểm tổng hợp thiếu ý nghĩa. Xem payload mẫu tại
`benchmark_bundle.example.json` và import idempotent bằng:

```powershell
npm run benchmark:import -- .\benchmark_bundle.example.json
```

Payload mẫu chỉ mô tả contract, phải thay toàn bộ số đo ví dụ bằng output benchmark thật trước khi
import. Bridge cung cấp `GET /api/benchmarks`, `POST /api/benchmarks/runs`; `/api/report` cũng nhúng
projection benchmark để frontend chỉ cần một lần tải.

Mỗi bot version mới bắt buộc có SHA-256 `artifactDigest` và `policyKey`; benchmark payload thiếu
provenance bị từ chối. Trang Benchmark cũng hiển thị quality gate của trajectory để phân biệt dữ
liệu đủ chuẩn với row raw/quarantine/rejected.

## Dữ liệu sẵn sàng cho training

Trajectory mới dùng contract v2 và vòng đời `raw -> train-eligible|rejected`. Server lưu state
trước/sau, observation, legal mask, action, actor-perspective reward, terminal reason, bot artifact,
policy metadata và checksum; match chỉ thành `train-eligible` sau khi replay bằng Rust/WASM pass.
Dữ liệu cũ mặc định `quarantined` và importer JSONL cũ bị fail-closed.

```powershell
npm run dataset:validate -- --limit 1000
npm run dataset:export -- --output .\output\datasets --name qas-training-v1 --seed 20260723
```

Exporter replay lại trước khi ghi, split ở biên series, loại gameplay trùng và tạo JSONL cùng
manifest/checksum có lineage trong MySQL. Contract đầy đủ nằm tại
[`../../docs/training_data_contract.md`](../../docs/training_data_contract.md).

Chạy từ repository root bằng `.\scripts\run_web.ps1`. Xem hướng dẫn đầy đủ tại
[`../README.md`](../README.md).
