import { useEffect, useRef } from 'react';

/** Clip source: https://clip.cafe/dexter-2006/surprise-motherfucker-s1/ */
export function DoakesVideo({
  active,
  onPlaying,
  onBlocked,
  onEnded,
}: {
  active: boolean;
  onPlaying: () => void;
  onBlocked: () => void;
  onEnded: () => void;
}) {
  const videoRef = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    const video = videoRef.current;

    if (!video || !active) {
      return () => video?.pause();
    }

    let cancelled = false;

    void video.play().catch(() => {
      if (!cancelled) {
        onBlocked();
      }
    });

    return () => {
      cancelled = true;
      video.pause();
    };
  }, [active, onBlocked]);

  return (
    <video
      ref={videoRef}
      src="/media/doakes-surprise.mp4"
      poster="/media/doakes-surprise.jpg"
      aria-label="Doakes says: Surprise, motherfucker."
      className="aspect-video w-full bg-black"
      playsInline
      preload="auto"
      disablePictureInPicture
      onPlaying={onPlaying}
      onEnded={onEnded}
      onError={onBlocked}
    >
      <track
        kind="captions"
        src="/media/doakes-surprise.vtt"
        srcLang="en"
        label="English"
        default
      />
    </video>
  );
}
