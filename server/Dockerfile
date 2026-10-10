# syntax=docker/dockerfile:1
FROM --platform=$BUILDPLATFORM golang:1.26-alpine AS build
WORKDIR /src
COPY go.mod go.sum ./
RUN go mod download
COPY . .
ARG TARGETOS TARGETARCH
RUN CGO_ENABLED=0 GOOS=$TARGETOS GOARCH=$TARGETARCH \
    go build -trimpath -ldflags="-s -w" -o /out/linkpark ./cmd/linkpark

FROM gcr.io/distroless/static-debian12
COPY --from=build /out/linkpark /linkpark
ENV LINKPARK_ADDR=:8080 \
    LINKPARK_DB=/data/linkpark.db
VOLUME /data
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=5s --start-period=5s --retries=3 CMD ["/linkpark", "healthcheck"]
ENTRYPOINT ["/linkpark"]
