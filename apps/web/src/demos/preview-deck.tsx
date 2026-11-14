import { Icon } from '@/components/icon';

export type PreviewName = 'Profile' | 'Settings';

function ProfilePreview() {
  return (
    <div className="preview-profile">
      <div className="preview-avatar">
        <Icon name="user" />
      </div>
      <div>
        <strong>Alex Morgan</strong>
        <span>Design engineer</span>
      </div>
      <div className="preview-profile-meta">
        <span>12 projects</span>
        <span>
          Available <i />
        </span>
      </div>
    </div>
  );
}

function SettingsPreview() {
  return (
    <div className="preview-settings">
      <div>
        <span>Appearance</span>
        <span>
          <Icon name="sun" /> Auto
        </span>
      </div>
      <div>
        <span>Notifications</span>
        <i className="preview-toggle" />
      </div>
      <div>
        <span>Stay a little ahead</span>
        <i className="preview-toggle" />
      </div>
    </div>
  );
}

export function PreviewDeck({ active }: { active: PreviewName | null }) {
  return (
    <div className="preview-deck" data-preview-active={active ?? 'none'} aria-hidden="true">
      <div className="preview-grid" />
      <div className="preview-orbit">
        <span />
        <span />
        <span />
        <span />
      </div>
      <div className="preview-cards">
        <div className="preview-card" data-view="Profile" data-active={active === 'Profile'}>
          <div className="preview-card-heading">
            <Icon name="user" />
            <span>Profile</span>
            <span>01</span>
          </div>
          <ProfilePreview />
          <div className="preview-card-footer">
            <span>YOUR SPACE</span>
            <Icon name="check" />
          </div>
        </div>
        <div className="preview-card" data-view="Settings" data-active={active === 'Settings'}>
          <div className="preview-card-heading">
            <Icon name="settings" />
            <span>Settings</span>
            <span>02</span>
          </div>
          <SettingsPreview />
          <div className="preview-card-footer">
            <span>MAKE IT YOURS</span>
            <Icon name="check" />
          </div>
        </div>
      </div>
      <div className="preview-ready">
        <Icon name="check" />
        <span>Preview ready</span>
      </div>
      <div className="preview-idle-label">A little ahead of you.</div>
    </div>
  );
}
