import { useId } from 'react'
import './Parameter.css'

/* 파라미터 슬라이더 (PRD 4.3-19, 20).
 *
 * 숫자만 보여주면 아무도 안 만진다. temperature가 0.6에서 1.2가 되면
 * 무엇이 달라지는지 한 줄로 말해준다.
 */

export default function Parameter({
  label,
  hint,
  value,
  min,
  max,
  step,
  onChange,
  format = (v) => v,
}) {
  const id = useId()

  return (
    <div className="param">
      <div className="param__head">
        <label className="param__label" htmlFor={id}>
          {label}
        </label>
        <output className="param__value tnum" htmlFor={id}>
          {format(value)}
        </output>
      </div>

      <input
        id={id}
        className="param__slider"
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(event) => onChange(Number(event.target.value))}
      />

      <p className="param__hint">{hint}</p>
    </div>
  )
}
