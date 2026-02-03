'use client'
import React from 'react'

export default function HiddenCard({ cardData, applyFoldedClassname, isShowdownCard }: any) {
  const { animationDelay } = cardData || {}
  
  // Apply card flip animation on showdown
  const cardClassName = isShowdownCard ? `playing-card cardIn robotcard card-flip ${applyFoldedClassname ? 'folded' : ''}` : `playing-card cardIn robotcard${applyFoldedClassname ? ' folded' : ''}`
  
  return (
    <div className={cardClassName} style={{ animationDelay: `${isShowdownCard ? (animationDelay || 0) + 500 : applyFoldedClassname ? 0 : animationDelay}ms`, padding: 8, minWidth: 36 }}>
    </div>
  )
}
