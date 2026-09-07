import { ButtonHTMLAttributes, ReactNode } from "react";
import { FiUser } from "react-icons/fi";
import classNames from "classnames";

type SeatPlaceholderProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  label: string;
  caption: string;
  avatar?: ReactNode;
  variant?: "reserved" | "claim" | "bot";
};

// The same avatar and panel geometry as an occupied seat, including its
// between-hands height, so taking a seat does not change the footprint.
export default function SeatPlaceholder({
  label,
  caption,
  avatar,
  variant,
  className,
  ...buttonProps
}: SeatPlaceholderProps) {
  return (
    <button
      {...buttonProps}
      type="button"
      className={classNames(
        "gps-seat gps-seat--idle gps-seat-placeholder",
        variant && `gps-seat-placeholder--${variant}`,
        className
      )}
    >
      <span className="gps-seat__panel">
        <span className="gps-seat-placeholder__label">{label}</span>
        <span className="gps-seat-placeholder__caption">{caption}</span>
      </span>
      <span className="gps-seat__avatar" aria-hidden="true">
        {avatar ?? <FiUser className="gps-seat-placeholder__icon" />}
      </span>
    </button>
  );
}
