import { Message } from "../../interfaces";
import { useTranslation } from "../../hooks/useTranslation";
import Avatar from "../Avatar";

type ChatMessageProps = Message & {
  own: boolean;
  uuid?: string;
  avatar: string;
  avatarImage: boolean;
  avatarVersion?: number;
};

export default function ChatMessage({
  name,
  message,
  timestamp,
  own,
  uuid,
  avatar,
  avatarImage,
  avatarVersion,
}: ChatMessageProps) {
  const { language } = useTranslation();

  if (name === "system") {
    const joined = message.match(/^(.+) has joined$/);
    const systemMessage =
      joined && language === "zh" ? `${joined[1]} 加入了牌局` : message;
    return (
      <div className="game-chat-system">
        <span>{systemMessage}</span>
        <time>{timestamp}</time>
      </div>
    );
  }

  return (
    <div className={`game-chat-message ${own ? "is-own" : ""}`}>
      {!own && (
        <span className="game-chat-message-avatar">
          <Avatar
            username={name}
            uuid={uuid}
            emoji={avatar}
            hasImage={avatarImage}
            size={28}
            version={avatarVersion}
          />
        </span>
      )}
      <div className="game-chat-message-body">
        {!own && <strong>{name}</strong>}
        <p>{message}</p>
        <time>{timestamp}</time>
      </div>
    </div>
  );
}
