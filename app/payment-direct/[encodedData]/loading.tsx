export default function Loading() {
  return (
    <div className="flex flex-col items-center justify-center min-h-screen bg-gray-50 p-4">
      <div className="w-full max-w-md p-8 bg-white rounded-lg shadow-lg">
        <div className="text-center">
          <div className="inline-block animate-spin rounded-full h-16 w-16 border-b-2 border-blue-600"></div>
          <h1 className="mt-4 text-xl font-bold text-gray-800">Đang tải...</h1>
          <p className="mt-2 text-gray-600">Vui lòng đợi trong giây lát</p>
        </div>
      </div>
    </div>
  );
}
