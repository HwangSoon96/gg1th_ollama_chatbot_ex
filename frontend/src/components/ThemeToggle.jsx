import './ThemeToggle.css'

/* 다크 모드 토글 (PRD 4.7-39).
 *
 * 아이콘만 두면 "지금 어느 쪽인지"와 "누르면 어디로 가는지"가 둘 다 모호하다.
 * 목적지를 쓴다: 지금 라이트면 "다크".
 */

export default function ThemeToggle({ theme, isSystem, onToggle }) {
  const next = theme === 'dark' ? '라이트' : '다크'

  return (
    <button
      type="button"
      className="theme-toggle"
      // 이벤트를 그대로 넘긴다 — 원형 확산의 중심을 버튼 위치에서 잡는다
      onClick={onToggle}
      title={isSystem ? 'OS 설정을 따르는 중입니다' : undefined}
      aria-label={`${next} 모드로 전환`}
    >
      {/* key를 바꿔 아이콘이 새로 마운트되게 한다 — 그래야 돌면서 바뀜다 */}
      <span className="theme-toggle__icon" key={theme} aria-hidden="true">
        {theme === 'dark' ? '☾' : '☀'}
      </span>
      <span className="theme-toggle__label">{next}</span>
      {isSystem && <span className="theme-toggle__auto">자동</span>}
    </button>
  )
}
