import Foundation

// 오프라인 팩 로컬 저장소 + 다운로드 매니저 (웹 downloadPack/IndexedDB → 네이티브 파일시스템).
// 산별 packs/<코드>/{base.pmtiles, routes/spots/contours.geojson} 를 앱 Application Support 에 설치.
// base.pmtiles 는 URLSessionDownloadTask 델리게이트로 바이트 진행률(전체의 90%), geojson 은 나머지.
// 오프라인 렌더(로컬 pmtiles:// + 로컬 geojson)는 MapView 가 이 저장소의 로컬 파일 URL 을 소스로 쓴다.
@MainActor
final class PackStore: NSObject, ObservableObject, URLSessionDownloadDelegate {
    static let shared = PackStore()

    @Published private(set) var downloaded: Set<String> = []   // 설치 완료된 산코드
    @Published private(set) var downloadingCode: String? = nil // 진행 중 산코드(nil=없음)
    @Published private(set) var progress: Double = 0           // 0…1
    @Published private(set) var status: String = ""

    private var progressHandler: ((Double) -> Void)?
    private var continuation: CheckedContinuation<URL, Error>?
    private lazy var session = URLSession(configuration: .default, delegate: self, delegateQueue: nil)

    // 저장 루트: Application Support/packs/<코드>/  (파일 경로만 다뤄 상태 비의존 → nonisolated)
    nonisolated private var root: URL {
        FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0]
            .appendingPathComponent("packs", isDirectory: true)
    }
    nonisolated func packDir(_ code: String) -> URL { root.appendingPathComponent(code, isDirectory: true) }
    // 로컬 팩 파일 URL(설치돼 있으면 반환, 없으면 nil) — MapView 오프라인 소스용.
    nonisolated func localFile(_ code: String, _ name: String) -> URL? {
        let u = packDir(code).appendingPathComponent(name)
        return FileManager.default.fileExists(atPath: u.path) ? u : nil
    }

    override init() { super.init(); refresh() }

    // 설치 판정: 필수 파일(base.pmtiles + routes.geojson)이 있으면 설치된 것으로 본다.
    nonisolated func isDownloaded(_ code: String) -> Bool {
        let d = packDir(code)
        return ["base.pmtiles", "routes.geojson"].allSatisfy {
            FileManager.default.fileExists(atPath: d.appendingPathComponent($0).path)
        }
    }
    func refresh() {
        var set = Set<String>()
        if let items = try? FileManager.default.contentsOfDirectory(atPath: root.path) {
            for c in items where isDownloaded(c) { set.insert(c) }
        }
        downloaded = set
    }

    func delete(_ code: String) {
        try? FileManager.default.removeItem(at: packDir(code))
        refresh()
    }

    // 다운로드: base.pmtiles(진행률 0→0.9) + geojson 3종(routes 필수 → 1.0). 성공 시 true.
    @discardableResult
    func download(_ code: String) async -> Bool {
        guard downloadingCode == nil, let baseURL = Config.baseTilesURL(code) else { return false }
        downloadingCode = code; progress = 0; status = "기저 지도 내려받는 중…"
        let dir = packDir(code)
        do {
            try FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
            // 1) base.pmtiles — 진행률 90% 까지
            let tmp = try await downloadWithProgress(baseURL) { [weak self] p in
                self?.progress = p * 0.9
            }
            try replace(at: dir.appendingPathComponent("base.pmtiles"), withItemAt: tmp)

            // 2) geojson — routes 필수, spots/contours 선택
            status = "등산로·시설·등고선 내려받는 중…"
            try await fetchJSON(Config.packURL(code, "routes.geojson"), to: dir.appendingPathComponent("routes.geojson"), required: true)
            progress = 0.94
            try? await fetchJSON(Config.packURL(code, "spots.geojson"), to: dir.appendingPathComponent("spots.geojson"), required: false)
            progress = 0.97
            try? await fetchJSON(Config.packURL(code, "contours.geojson"), to: dir.appendingPathComponent("contours.geojson"), required: false)
            progress = 1.0

            status = "다운로드 완료"
            downloadingCode = nil; refresh()
            return true
        } catch {
            status = "다운로드 실패: \(error.localizedDescription)"
            downloadingCode = nil
            try? FileManager.default.removeItem(at: dir)   // 부분 다운로드 정리
            refresh()
            return false
        }
    }

    private func replace(at dst: URL, withItemAt src: URL) throws {
        if FileManager.default.fileExists(atPath: dst.path) { try FileManager.default.removeItem(at: dst) }
        try FileManager.default.moveItem(at: src, to: dst)
    }

    private func fetchJSON(_ url: URL?, to dst: URL, required: Bool) async throws {
        guard let url else { if required { throw PackError.missingRoutes }; return }
        let (data, resp) = try await URLSession.shared.data(from: url)
        guard (resp as? HTTPURLResponse)?.statusCode == 200 else {
            if required { throw PackError.missingRoutes }; return
        }
        if FileManager.default.fileExists(atPath: dst.path) { try FileManager.default.removeItem(at: dst) }
        try data.write(to: dst)
    }

    enum PackError: LocalizedError {
        case missingRoutes
        var errorDescription: String? { "등산로 데이터 없음" }
    }

    // 진행률 있는 다운로드(base.pmtiles) — 델리게이트를 async 로 감쌈.
    private func downloadWithProgress(_ url: URL, onProgress: @escaping (Double) -> Void) async throws -> URL {
        progressHandler = onProgress
        return try await withCheckedThrowingContinuation { cont in
            continuation = cont
            session.downloadTask(with: url).resume()
        }
    }

    // MARK: URLSessionDownloadDelegate (백그라운드 큐 → MainActor 로 hop)
    nonisolated func urlSession(_ s: URLSession, downloadTask t: URLSessionDownloadTask,
                                didWriteData _: Int64, totalBytesWritten written: Int64,
                                totalBytesExpectedToWrite total: Int64) {
        guard total > 0 else { return }
        let p = Double(written) / Double(total)
        Task { @MainActor in self.progressHandler?(p) }
    }
    nonisolated func urlSession(_ s: URLSession, downloadTask t: URLSessionDownloadTask,
                                didFinishDownloadingTo location: URL) {
        // 델리게이트 종료 후 임시파일이 삭제되므로 즉시 별도 임시경로로 옮겨 보존.
        let keep = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        try? FileManager.default.moveItem(at: location, to: keep)
        Task { @MainActor in self.continuation?.resume(returning: keep); self.continuation = nil }
    }
    nonisolated func urlSession(_ s: URLSession, task: URLSessionTask, didCompleteWithError error: Error?) {
        guard let error else { return }
        Task { @MainActor in
            if let c = self.continuation { c.resume(throwing: error); self.continuation = nil }
        }
    }
}
