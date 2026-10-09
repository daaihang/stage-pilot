package storage

import (
	"context"
	"errors"
	"io"
	"os"
	"strings"
	"testing"
	"time"

	"github.com/minio/minio-go/v7"
)

func TestMinIORequiresEndpoint(t *testing.T) {
	if _, err := NewMinIO(MinIOConfig{}); err == nil {
		t.Fatal("expected empty endpoint to fail")
	}
}

func TestMapProviderErrors(t *testing.T) {
	for _, test := range []struct {
		code string
		want error
	}{{"NoSuchKey", ErrObjectNotFound}, {"NoSuchBucket", ErrObjectNotFound}, {"NoSuchUpload", ErrMultipartNotFound}} {
		t.Run(test.code, func(t *testing.T) {
			if err := mapError(minio.ErrorResponse{Code: test.code}); !errors.Is(err, test.want) {
				t.Fatalf("mapError() = %v; want errors.Is(_, %v)", err, test.want)
			}
		})
	}
}

func TestMinIORejectsInvalidByteRangeBeforeRequest(t *testing.T) {
	client, err := NewMinIO(MinIOConfig{Endpoint: "http://127.0.0.1:1", PathStyle: true})
	if err != nil {
		t.Fatal(err)
	}
	for _, value := range []ObjectRange{{Start: -1, End: 0}, {Start: 2, End: 1}} {
		if _, err := client.OpenObjectRange(context.Background(), ObjectRef{Bucket: "bucket", Key: "key"}, value); err == nil {
			t.Fatalf("invalid range accepted: %+v", value)
		}
	}
}

func TestMinIOAdapterE2E(t *testing.T) {
	if os.Getenv("STORAGE_E2E") != "1" {
		t.Skip("set STORAGE_E2E=1 and configure a disposable S3-compatible bucket")
	}
	bucket := os.Getenv("STORAGE_TEST_BUCKET")
	if bucket == "" {
		t.Fatal("STORAGE_TEST_BUCKET is required when STORAGE_E2E=1")
	}
	if !strings.HasSuffix(bucket, "-test") {
		t.Fatal("STORAGE_TEST_BUCKET must name a dedicated *-test bucket")
	}
	client, err := NewMinIO(MinIOConfig{
		Endpoint: os.Getenv("S3_ENDPOINT"), AccessKey: os.Getenv("S3_ACCESS_KEY"), SecretKey: os.Getenv("S3_SECRET_KEY"),
		Secure: os.Getenv("S3_USE_SSL") == "true", Region: envOr("S3_REGION", "us-east-1"), PathStyle: true,
	})
	if err != nil {
		t.Fatal(err)
	}
	ctx, cancel := context.WithTimeout(t.Context(), 45*time.Second)
	defer cancel()
	if err := client.EnsureBucket(ctx, bucket, envOr("S3_REGION", "us-east-1")); err != nil {
		t.Fatal(err)
	}
	versioning, err := client.BucketVersioningStatus(ctx, bucket)
	if err != nil {
		t.Fatal(err)
	}
	if versioning != "" {
		t.Fatalf("test bucket must have versioning disabled, got %q", versioning)
	}
	prefix := "storage-adapter-e2e/" + time.Now().UTC().Format("20060102T150405.000000000")
	ref := ObjectRef{Bucket: bucket, Key: prefix + "/source.txt"}
	copyRef := ObjectRef{Bucket: bucket, Key: prefix + "/copy.txt"}
	defer func() {
		_ = client.RemoveObject(context.Background(), ref)
		_ = client.RemoveObject(context.Background(), copyRef)
	}()
	info, err := client.PutObject(ctx, ref, strings.NewReader("alpha-beta"), int64(len("alpha-beta")), "text/plain")
	if err != nil {
		t.Fatal(err)
	}
	stat, err := client.StatObject(ctx, ref)
	if err != nil || stat.Size != 10 || stat.ETag == "" {
		t.Fatalf("stat object = %+v, %v", stat, err)
	}
	ranged, err := client.OpenObjectRange(ctx, ref, ObjectRange{Start: 2, End: 4})
	if err != nil {
		t.Fatal(err)
	}
	data, readErr := io.ReadAll(ranged)
	closeErr := ranged.Close()
	if readErr != nil || closeErr != nil || string(data) != "pha" {
		t.Fatalf("range read = %q, read error=%v, close error=%v", data, readErr, closeErr)
	}
	if _, err := client.CopyObject(ctx, ref, copyRef, info.ETag, info.Size); err != nil {
		t.Fatal(err)
	}
	if _, err := client.PresignPut(ctx, ref, time.Minute); err != nil {
		t.Fatal(err)
	}
	if _, err := client.PresignPost(ctx, ref, "text/plain", 1, 100, time.Minute); err != nil {
		t.Fatal(err)
	}
	if _, err := client.PresignGet(ctx, ref, time.Minute, nil); err != nil {
		t.Fatal(err)
	}
	if _, err := client.PresignPart(ctx, copyRef, "upload-id", UploadPartSpec{PartNumber: 1, Size: 5}, time.Minute); err != nil {
		t.Fatal(err)
	}
	var walked bool
	if err := client.WalkObjects(ctx, bucket, prefix, func(object ObjectInfo) error {
		if object.Key == ref.Key {
			walked = true
		}
		return nil
	}); err != nil || !walked {
		t.Fatalf("inventory did not find source object: walked=%v err=%v", walked, err)
	}
	page, err := client.ListMultipartUploads(ctx, bucket, prefix, "", "", 100)
	if err != nil || page.IsTruncated {
		t.Fatalf("multipart inventory page = %+v, %v", page, err)
	}
}

func envOr(name, fallback string) string {
	if value := os.Getenv(name); value != "" {
		return value
	}
	return fallback
}
