import { useCallback, useEffect, useRef, useState } from 'react'

type DialogRef = { current: HTMLDialogElement | null }

type Swipe = {
  touchId: number
  startX: number
  startY: number
  scrollContainer: HTMLElement | null
}

const dismissAnimationDuration = 260

function getDialogDragTarget(dialog: HTMLDialogElement) {
  return dialog.querySelector<HTMLElement>('.task-dialog-form') ?? dialog
}

export function dismissMobileDialog(dialog: HTMLDialogElement | null, onDismiss: () => void) {
  if (!dialog?.open || !window.matchMedia('(max-width: 680px)').matches || window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
    onDismiss()
    return
  }
  if (dialog.classList.contains('mobile-dialog-dismissing')) return

  const dragTarget = getDialogDragTarget(dialog)
  dialog.classList.remove('mobile-dialog-dragging', 'mobile-dialog-settling')
  dragTarget.classList.remove('mobile-dialog-dragging', 'mobile-dialog-settling')
  dialog.classList.add('mobile-dialog-dismissing')

  let timeout = 0
  let finished = false
  const finish = () => {
    if (finished) return
    finished = true
    window.clearTimeout(timeout)
    dialog.removeEventListener('transitionend', onTransitionEnd)
    // Clear the dragged layer while it is invisible, then let Safari paint it
    // once before closing the native dialog to avoid leaving a composited edge.
    window.requestAnimationFrame(() => {
      dragTarget.style.removeProperty('translate')
      window.requestAnimationFrame(() => {
        if (dialog.open) dialog.close()
        dialog.classList.remove('mobile-dialog-dismissing')
        onDismiss()
      })
    })
  }
  const onTransitionEnd = (event: TransitionEvent) => {
    if (event.target === dialog && event.propertyName === 'opacity') finish()
  }
  dialog.addEventListener('transitionend', onTransitionEnd)
  timeout = window.setTimeout(finish, dismissAnimationDuration + 80)
}

export function useMobileDialogSwipeDismiss(dialogRef: DialogRef, onDismiss: () => void, enabled = true) {
  const [dialog, setDialog] = useState<HTMLDialogElement | null>(null)
  const attachDialogRef = useCallback((element: HTMLDialogElement | null) => {
    dialogRef.current = element
    setDialog(element)
  }, [dialogRef])
  const onDismissRef = useRef(onDismiss)
  const enabledRef = useRef(enabled)
  onDismissRef.current = onDismiss
  enabledRef.current = enabled

  useEffect(() => {
    if (!dialog) return
    const activeDialog = dialog

    const mobile = window.matchMedia('(max-width: 680px)')
    let swipe: Swipe | null = null

    function reset(settle = false) {
      const dragTarget = getDialogDragTarget(activeDialog)
      const wasDragged = dragTarget.style.getPropertyValue('translate') !== ''
      swipe = null
      activeDialog.classList.remove('mobile-dialog-dragging')
      if (activeDialog.open) activeDialog.classList.remove('mobile-dialog-dismissing')
      dragTarget.classList.remove('mobile-dialog-dragging')
      dragTarget.style.removeProperty('translate')
      if (settle && wasDragged && activeDialog.isConnected) {
        dragTarget.classList.add('mobile-dialog-settling')
        window.setTimeout(() => dragTarget.classList.remove('mobile-dialog-settling'), 180)
      } else {
        activeDialog.classList.remove('mobile-dialog-settling')
        dragTarget.classList.remove('mobile-dialog-settling')
      }
    }

    function findScrollContainer(target: Element) {
      let current = target instanceof HTMLElement ? target : target.parentElement
      while (current && current !== activeDialog) {
        const { overflowY } = window.getComputedStyle(current)
        if (/(auto|scroll|overlay)/.test(overflowY) && current.scrollHeight > current.clientHeight + 1) return current
        current = current.parentElement
      }
      return null
    }

    function onTouchStart(event: TouchEvent) {
      if (!enabledRef.current || !mobile.matches || !activeDialog.open || event.touches.length !== 1) return
      if (!(event.target instanceof Element)) return
      if (event.target.closest('button, input, textarea, select, a, [contenteditable="true"]')) return

      const scrollContainer = findScrollContainer(event.target)
      if (scrollContainer && scrollContainer.scrollTop > 0) return
      const touch = event.touches[0]

      swipe = {
        touchId: touch.identifier,
        startX: touch.clientX,
        startY: touch.clientY,
        scrollContainer,
      }
    }

    function onTouchMove(event: TouchEvent) {
      if (!swipe) return
      if (event.touches.length !== 1) {
        reset(true)
        return
      }
      const touch = Array.from(event.touches).find(candidate => candidate.identifier === swipe?.touchId)
      if (!touch) return

      const deltaX = touch.clientX - swipe.startX
      const deltaY = touch.clientY - swipe.startY
      if ((Math.abs(deltaX) > 16 && Math.abs(deltaX) > Math.abs(deltaY)) || deltaY < -8) {
        reset(true)
        return
      }
      if (deltaY < 6) return
      if (swipe.scrollContainer && swipe.scrollContainer.scrollTop > 0) {
        reset(true)
        return
      }

      if (event.cancelable) event.preventDefault()
      const dragTarget = getDialogDragTarget(activeDialog)
      activeDialog.classList.add('mobile-dialog-dragging')
      dragTarget.classList.add('mobile-dialog-dragging')
      dragTarget.style.setProperty('translate', `0 ${Math.min(deltaY, window.innerHeight)}px`)
    }

    function onTouchEnd(event: TouchEvent) {
      if (!swipe) return
      const touch = Array.from(event.changedTouches).find(candidate => candidate.identifier === swipe?.touchId)
      if (!touch) return

      const deltaY = touch.clientY - swipe.startY
      const shouldDismiss = deltaY > activeDialog.getBoundingClientRect().height / 2
      if (shouldDismiss && enabledRef.current) {
        swipe = null
        dismissMobileDialog(activeDialog, () => onDismissRef.current())
      } else {
        reset(true)
      }
    }

    function onTouchCancel() {
      reset(true)
    }

    function onDialogClose() {
      reset()
    }

    activeDialog.addEventListener('touchstart', onTouchStart, { passive: true })
    activeDialog.addEventListener('touchmove', onTouchMove, { passive: false })
    activeDialog.addEventListener('touchend', onTouchEnd)
    activeDialog.addEventListener('touchcancel', onTouchCancel)
    activeDialog.addEventListener('close', onDialogClose)

    return () => {
      activeDialog.removeEventListener('touchstart', onTouchStart)
      activeDialog.removeEventListener('touchmove', onTouchMove)
      activeDialog.removeEventListener('touchend', onTouchEnd)
      activeDialog.removeEventListener('touchcancel', onTouchCancel)
      activeDialog.removeEventListener('close', onDialogClose)
      reset()
    }
  }, [dialog])

  return attachDialogRef
}
