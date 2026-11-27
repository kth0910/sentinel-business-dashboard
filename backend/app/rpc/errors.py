class RpcError(Exception):
    status: int = 500
    name: str = "InternalError"

    def __init__(self, message: str) -> None:
        super().__init__(message)
        self.message = message


class ValidationError(RpcError):
    status = 400
    name = "ValidationError"


class UnauthorizedError(RpcError):
    status = 401
    name = "UnauthorizedError"


class PermissionDenied(RpcError):
    status = 403
    name = "PermissionError"


class NotFoundError(RpcError):
    status = 404
    name = "NotFound"


class PayloadTooLargeError(RpcError):
    status = 413
    name = "ValidationError"


class RateLimitedError(RpcError):
    status = 429
    name = "RateLimitedError"
