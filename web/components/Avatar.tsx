const SIZES = [64, 128, 256, 512, 1024];

function pickSize(px: number): number {
    for (const s of SIZES) {
        if (s >= px) {
            return s;
        }
    }
    return 1024;
}

type AvatarProps = {
    username: string;
    emoji: string;
    hasImage: boolean;
    size?: number;
};

export default function Avatar({ username, emoji, hasImage, size = 32 }: AvatarProps) {
    if (hasImage && username) {
        const src = `/api/avatar?username=${encodeURIComponent(username)}&size=${pickSize(size)}`;
        return (
            <img
                src={src}
                alt={username}
                className="rounded-full object-cover"
                style={{ width: size, height: size }}
            />
        );
    }
    return (
        <span
            style={{ fontSize: Math.round(size * 0.7), lineHeight: `${size}px` }}
        >
            {emoji || "🙂"}
        </span>
    );
}
