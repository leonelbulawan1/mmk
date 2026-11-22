// Renders word-level diff ops returned by the backend's pure diff() function.
export default function DiffView({ ops }) {
  if (!ops?.length) return null
  return (
    <p className="whitespace-pre-wrap text-lg leading-8">
      {ops.map((op, i) => {
        if (op.op === 'equal') return <span key={i}>{op.before}</span>
        return (
          <span key={i}>
            {op.before && <del className="rounded bg-rose-100 px-0.5 text-rose-600 decoration-rose-600/60">{op.before}</del>}
            {op.after && <ins className="rounded bg-sage-100 px-0.5 text-sage-600 no-underline">{op.after}</ins>}
          </span>
        )
      })}
    </p>
  )
}
