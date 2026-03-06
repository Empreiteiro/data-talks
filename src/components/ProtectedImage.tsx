import { getToken } from "@/config";
import { CSSProperties, ImgHTMLAttributes, ReactNode, useEffect, useState } from "react";

interface ProtectedImageProps extends Omit<ImgHTMLAttributes<HTMLImageElement>, "src"> {
  src: string;
  loadingFallback?: ReactNode;
  errorFallback?: ReactNode;
}

function isDirectSrc(src: string): boolean {
  return src.startsWith("data:") || src.startsWith("blob:");
}

export function ProtectedImage({
  src,
  alt,
  loadingFallback = null,
  errorFallback = null,
  onLoad,
  onError,
  style,
  ...imgProps
}: ProtectedImageProps) {
  const [resolvedSrc, setResolvedSrc] = useState<string>(isDirectSrc(src) ? src : "");
  const [loading, setLoading] = useState<boolean>(!isDirectSrc(src));
  const [hasError, setHasError] = useState(false);

  useEffect(() => {
    if (!src) {
      setResolvedSrc("");
      setLoading(false);
      setHasError(true);
      return;
    }

    if (isDirectSrc(src)) {
      setResolvedSrc(src);
      setLoading(false);
      setHasError(false);
      return;
    }

    let cancelled = false;
    let objectUrl: string | null = null;
    const token = getToken();

    setResolvedSrc("");
    setLoading(true);
    setHasError(false);

    const loadImage = async () => {
      try {
        const response = await fetch(src, {
          headers: token ? { Authorization: `Bearer ${token}` } : {},
        });
        if (!response.ok) {
          throw new Error(`Failed to load image: ${response.status}`);
        }
        const blob = await response.blob();
        objectUrl = URL.createObjectURL(blob);
        if (!cancelled) {
          setResolvedSrc(objectUrl);
          setLoading(false);
        }
      } catch {
        if (!cancelled) {
          setLoading(false);
          setHasError(true);
        }
      }
    };

    void loadImage();

    return () => {
      cancelled = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [src]);

  if (hasError) {
    return <>{errorFallback}</>;
  }

  if (loading || !resolvedSrc) {
    return <>{loadingFallback}</>;
  }

  return (
    <img
      {...imgProps}
      src={resolvedSrc}
      alt={alt}
      style={style as CSSProperties}
      onLoad={(event) => onLoad?.(event)}
      onError={(event) => {
        setHasError(true);
        onError?.(event);
      }}
    />
  );
}
