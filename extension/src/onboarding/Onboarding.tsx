import { useEffect, useState } from 'react'
import { ImportPanel } from '../components/ImportPanel'
import { SettingsForm } from '../components/SettingsForm'
import { getItem, isConfigured, patchItem } from '../lib/storage'

type Step = 'loading' | 'connect' | 'import' | 'done'

const STEPS: { key: Step; label: string }[] = [
  { key: 'connect', label: '连接服务端' },
  { key: 'import', label: '导入书签' },
  { key: 'done', label: '完成' },
]

export function Onboarding() {
  const [step, setStep] = useState<Step>('loading')

  useEffect(() => {
    void Promise.all([getItem('settings'), getItem('onboarding')]).then(([s, o]) => {
      if (!isConfigured(s)) setStep('connect')
      else if (!o.importDone && !o.completed) setStep('import')
      else setStep('done')
    })
  }, [])

  const finish = async () => {
    await patchItem('onboarding', { completed: true })
    setStep('done')
  }

  const current = STEPS.findIndex((s) => s.key === step)

  return (
    <main className="mx-auto max-w-xl px-6 py-16">
      <div className="mb-10 flex items-center gap-3">
        <img src="/icons/icon-48.png" width={40} height={40} alt="" />
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">欢迎使用 LinkPark</h1>
          <p className="text-sm text-zinc-500">简洁现代的云端书签管理器</p>
        </div>
      </div>

      <ol className="mb-8 flex gap-2 text-xs">
        {STEPS.map((s, i) => (
          <li
            key={s.key}
            className={`flex-1 border-t-2 pt-2 ${i <= current ? 'border-indigo-600 text-indigo-600' : 'border-zinc-200 text-zinc-400 dark:border-zinc-700'}`}
          >
            {i + 1}. {s.label}
          </li>
        ))}
      </ol>

      <div className="rounded-xl border border-zinc-200 p-6 dark:border-zinc-800">
        {step === 'connect' && (
          <>
            <p className="mb-5 text-sm text-zinc-600 dark:text-zinc-300">填写你部署的 LinkPark 服务端地址，以及服务端配置的 LINKPARK_TOKEN。</p>
            <SettingsForm submitLabel="连接并继续" onSaved={() => setStep('import')} />
          </>
        )}
        {step === 'import' && <ImportPanel onFinished={() => void finish()} onSkip={() => void finish()} />}
        {step === 'done' && (
          <div className="space-y-3 text-sm text-zinc-600 dark:text-zinc-300">
            <p className="text-base font-medium text-zinc-900 dark:text-zinc-100">一切就绪</p>
            <ul className="list-inside list-disc space-y-1">
              <li>在任意网页或链接上右键，选择「添加到 LinkPark」</li>
              <li>点击工具栏的 LinkPark 图标查看、搜索和按标签筛选书签</li>
              <li>建议将 LinkPark 固定到工具栏，方便随时打开</li>
            </ul>
            <button className="btn-primary mt-2" onClick={() => window.close()}>
              开始使用
            </button>
          </div>
        )}
      </div>
    </main>
  )
}
