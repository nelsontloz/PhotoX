from fastapi import FastAPI, Response
from prometheus_client import Counter, generate_latest, CONTENT_TYPE_LATEST

app = FastAPI(
    title="photox-ml-service",
    docs_url="/api/v1/ml/docs",
    openapi_url="/api/v1/ml/openapi.json",
)
request_counter = Counter("ml_requests_total", "Total ML requests")


@app.get("/health")
def health():
    return {"status": "ok", "service": "ml-service"}


@app.get("/metrics")
def metrics():
    return Response(generate_latest(), media_type=CONTENT_TYPE_LATEST)


@app.get("/")
def root():
    request_counter.inc()
    return {"message": "ml service scaffold"}
