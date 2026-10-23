import { useCallback, useEffect, useRef, useState } from 'react'

type DialogRef = { current: HTMLDialogElement | null }

type Swipe = {
  touchId: number
  startX: number
  startY: number
  startedAt: number
  scrollContainer: HTMLElement | null
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
      const wasDragged = activeDialog.style.getPropertyValue('translate') !== ''
      swipe = null
      activeDialog.classList.remove('mobile-dialog-dragging')
      activeDialog.style.removeProperty('translate')
      if (settle && wasDragged && activeDialog.isConnected) {
        activeDialog.classList.add('mobile-dialog-settling')
        window.setTimeout(() => activeDialog.classList.remove('mobile-dialog-settling'), 180)
      } else {
        activeDialog.classList.remove('mobile-dialog-settling')
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
        startedAt: performance.now(),
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
      activeDialog.classList.add('mobile-dialog-dragging')
      activeDialog.style.setProperty('translate', `0 ${Math.min(deltaY, window.innerHeight)}px`)
    }

    function onTouchEnd(event: TouchEvent) {
      if (!swipe) return
      const touch = Array.from(event.changedTouches).find(candidate => candidate.identifier === swipe?.touchId)
      if (!touch) return

      const deltaY = touch.clientY - swipe.startY
      const elapsed = Math.max(1, performance.now() - swipe.startedAt)
      const shouldDismiss = deltaY >= 110 || (deltaY >= 56 && deltaY / elapsed >= 0.65)
      reset(!shouldDismiss)
      if (shouldDismiss && enabledRef.current) onDismissRef.current()
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
