import { useEffect, useState } from "react";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { requestBlob } from "@/lib/auth";

function useAvatarSource(avatarUrl) {
  const managed = typeof avatarUrl === "string" && avatarUrl.startsWith("/v1/users/") && avatarUrl.includes("/avatar?");
  const [loaded, setLoaded] = useState({ key: "", url: "" });

  useEffect(() => {
    if (!managed) return undefined;
    let active = true;
    let objectUrl = "";
    setLoaded({ key: avatarUrl, url: "" });
    const controller = new AbortController();
    requestBlob(avatarUrl, { signal: controller.signal })
      .then((blob) => {
        if (!active) return;
        objectUrl = URL.createObjectURL(blob);
        setLoaded({ key: avatarUrl, url: objectUrl });
      })
      .catch(() => {
        if (active) setLoaded({ key: avatarUrl, url: "" });
      });
    return () => {
      active = false;
      controller.abort();
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [avatarUrl, managed]);

  if (!avatarUrl) return undefined;
  if (!managed) return avatarUrl;
  return loaded.key === avatarUrl ? loaded.url || undefined : undefined;
}

export function UserAvatar({ avatarUrl, name, fallback, size, className }) {
  const src = useAvatarSource(avatarUrl);
  return (
    <Avatar size={size} className={className}>
      <AvatarImage src={src} alt={name || "用户头像"} />
      <AvatarFallback>{fallback ?? name?.slice(0, 2) ?? "U"}</AvatarFallback>
    </Avatar>
  );
}
