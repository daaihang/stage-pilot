// Package storage defines the provider-neutral object-storage ports shared by
// the API and Worker processes. File policy, authorization and database state
// deliberately live outside this package.
package storage

import (
	"context"
	"io"
	"net/url"
	"time"
)

type ObjectRef struct {
	Bucket string
	Key    string
}

type ObjectInfo struct {
	Key         string
	Size        int64
	ETag        string
	ContentType string
}

type ObjectPart struct {
	PartNumber     int
	Size           int64
	ETag           string
	ChecksumSHA256 string
}

type CompletedPart struct {
	PartNumber     int
	ETag           string
	ChecksumSHA256 string
}

type PartsPage struct {
	Parts                []ObjectPart
	NextPartNumberMarker int
	IsTruncated          bool
}

type MultipartUpload struct {
	Key      string
	UploadID string
}

type MultipartUploadsPage struct {
	Uploads            []MultipartUpload
	NextKeyMarker      string
	NextUploadIDMarker string
	IsTruncated        bool
}

type UploadPartSpec struct {
	PartNumber     int
	Size           int64
	ChecksumSHA256 string
}

type PresignedRequest struct {
	URL     *url.URL
	Fields  map[string]string
	Headers map[string]string
	Method  string
}

type ObjectRange struct {
	// Start and End are inclusive byte offsets, matching the HTTP Range model.
	Start int64
	End   int64
}

type ObjectReader interface {
	StatObject(context.Context, ObjectRef) (ObjectInfo, error)
	OpenObject(context.Context, ObjectRef) (io.ReadCloser, error)
	OpenObjectRange(context.Context, ObjectRef, ObjectRange) (io.ReadCloser, error)
}

type ObjectWriter interface {
	PutObject(context.Context, ObjectRef, io.Reader, int64, string) (ObjectInfo, error)
	CopyObject(context.Context, ObjectRef, ObjectRef, string, int64) (ObjectInfo, error)
	RemoveObject(context.Context, ObjectRef) error
}

type UploadManager interface {
	PresignPut(context.Context, ObjectRef, time.Duration) (PresignedRequest, error)
	PresignPost(context.Context, ObjectRef, string, int64, int64, time.Duration) (PresignedRequest, error)
	PresignGet(context.Context, ObjectRef, time.Duration, map[string]string) (PresignedRequest, error)
	PresignPart(context.Context, ObjectRef, string, UploadPartSpec, time.Duration) (PresignedRequest, error)
	BeginMultipart(context.Context, ObjectRef) (string, error)
	ListParts(context.Context, ObjectRef, string, int, int) (PartsPage, error)
	CompleteMultipart(context.Context, ObjectRef, string, []CompletedPart) (ObjectInfo, error)
	AbortMultipart(context.Context, ObjectRef, string) error
}

type BucketAdmin interface {
	EnsureBucket(context.Context, string, string) error
	BucketVersioningStatus(context.Context, string) (string, error)
}

type Inventory interface {
	WalkObjects(context.Context, string, string, func(ObjectInfo) error) error
	ListMultipartUploads(context.Context, string, string, string, string, int) (MultipartUploadsPage, error)
}

// Client is the full capability set used at process composition roots. Use the
// smaller embedded ports in services and tests whenever fewer operations are
// required.
type Client interface {
	ObjectReader
	ObjectWriter
	UploadManager
	BucketAdmin
	Inventory
}
