import { useTranslation } from "../hooks/useTranslation";

type AssetLoadingProps = { progress: number };

export default function AssetLoading({ progress }: AssetLoadingProps) {
  const { t } = useTranslation();
  const percent = Math.round(progress * 100);
  return (
    <div
      className="flex min-h-[12rem] flex-col items-center justify-center gap-3 px-8"
      role="status"
    >
      <p className="text-sm text-muted">
        {t("loadingAssets")} · {percent}%
      </p>
      <div
        className="h-1.5 w-full max-w-xs overflow-hidden rounded-full bg-card"
        aria-hidden="true"
      >
        <div
          className="h-full rounded-full bg-ink"
          style={{ width: `${percent}%` }}
        />
      </div>
    </div>
  );
}
