let matrixPromise = null;

function loadMatrix() {
  if (!matrixPromise) matrixPromise = import("https://esm.sh/ml-matrix@6.12.1");
  return matrixPromise;
}

function clampByte(value) {
  return Math.max(0, Math.min(255, Math.round(value)));
}

function computeStats(imageData, sampleStep) {
  const { data, width, height } = imageData;
  const mean = [0, 0, 0];
  let count = 0;

  for (let y = 0; y < height; y += sampleStep) {
    for (let x = 0; x < width; x += sampleStep) {
      const offset = (y * width + x) * 4;
      mean[0] += data[offset];
      mean[1] += data[offset + 1];
      mean[2] += data[offset + 2];
      count += 1;
    }
  }

  mean[0] /= count;
  mean[1] /= count;
  mean[2] /= count;

  const cov = [
    [0, 0, 0],
    [0, 0, 0],
    [0, 0, 0],
  ];

  for (let y = 0; y < height; y += sampleStep) {
    for (let x = 0; x < width; x += sampleStep) {
      const offset = (y * width + x) * 4;
      const d0 = data[offset] - mean[0];
      const d1 = data[offset + 1] - mean[1];
      const d2 = data[offset + 2] - mean[2];
      cov[0][0] += d0 * d0;
      cov[0][1] += d0 * d1;
      cov[0][2] += d0 * d2;
      cov[1][1] += d1 * d1;
      cov[1][2] += d1 * d2;
      cov[2][2] += d2 * d2;
    }
  }

  const denom = Math.max(1, count - 1);
  cov[0][0] = cov[0][0] / denom + 1;
  cov[0][1] /= denom;
  cov[0][2] /= denom;
  cov[1][0] = cov[0][1];
  cov[1][1] = cov[1][1] / denom + 1;
  cov[1][2] /= denom;
  cov[2][0] = cov[0][2];
  cov[2][1] = cov[1][2];
  cov[2][2] = cov[2][2] / denom + 1;

  return { mean, cov };
}

function sqrtSymmetric(matrix, Matrix, EigenvalueDecomposition, inverse = false) {
  const symmetric = [
    [matrix[0][0], (matrix[0][1] + matrix[1][0]) / 2, (matrix[0][2] + matrix[2][0]) / 2],
    [(matrix[1][0] + matrix[0][1]) / 2, matrix[1][1], (matrix[1][2] + matrix[2][1]) / 2],
    [(matrix[2][0] + matrix[0][2]) / 2, (matrix[2][1] + matrix[1][2]) / 2, matrix[2][2]],
  ];
  const decomposition = new EigenvalueDecomposition(new Matrix(symmetric), { assumeSymmetric: true });
  const values = decomposition.realEigenvalues.map((value) => {
    const safe = Math.max(value, 1e-6);
    return inverse ? 1 / Math.sqrt(safe) : Math.sqrt(safe);
  });
  const vectors = decomposition.eigenvectorMatrix;
  return vectors.mmul(Matrix.diag(values)).mmul(vectors.transpose());
}

function buildMklTransform(sourceStats, targetStats, Matrix, EigenvalueDecomposition) {
  const targetCov = new Matrix(targetStats.cov);
  const sourceSqrt = sqrtSymmetric(sourceStats.cov, Matrix, EigenvalueDecomposition);
  const sourceInvSqrt = sqrtSymmetric(sourceStats.cov, Matrix, EigenvalueDecomposition, true);
  const middle = sourceSqrt.mmul(targetCov).mmul(sourceSqrt);
  const middleSqrt = sqrtSymmetric(middle.to2DArray(), Matrix, EigenvalueDecomposition);
  const transform = sourceInvSqrt.mmul(middleSqrt).mmul(sourceInvSqrt);
  return transform.to2DArray();
}

function applyMkl(imageData, sourceStats, targetStats, Matrix, EigenvalueDecomposition) {
  const transform = buildMklTransform(sourceStats, targetStats, Matrix, EigenvalueDecomposition);
  const { data } = imageData;
  const sm = sourceStats.mean;
  const tm = targetStats.mean;

  for (let i = 0; i < data.length; i += 4) {
    const r = data[i] - sm[0];
    const g = data[i + 1] - sm[1];
    const b = data[i + 2] - sm[2];
    data[i] = clampByte(transform[0][0] * r + transform[0][1] * g + transform[0][2] * b + tm[0]);
    data[i + 1] = clampByte(transform[1][0] * r + transform[1][1] * g + transform[1][2] * b + tm[1]);
    data[i + 2] = clampByte(transform[2][0] * r + transform[2][1] * g + transform[2][2] * b + tm[2]);
  }

  return imageData;
}

self.addEventListener("message", async (event) => {
  const { id, type, imageData, sampleStep, reference } = event.data || {};
  try {
    if (type === "reference") {
      self.postMessage({ id, ok: true, result: { stats: computeStats(imageData, sampleStep) } });
      return;
    }

    if (type === "apply") {
      const { Matrix, EigenvalueDecomposition } = await loadMatrix();
      const current = computeStats(imageData, sampleStep);
      const processed = applyMkl(imageData, current, reference, Matrix, EigenvalueDecomposition);
      self.postMessage({ id, ok: true, result: { imageData: processed } }, [processed.data.buffer]);
      return;
    }

    throw new Error("未対応の MKL Worker 処理です。");
  } catch (error) {
    self.postMessage({ id, ok: false, error: error?.message || String(error) });
  }
});
