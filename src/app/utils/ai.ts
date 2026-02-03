// AI logic for CPU poker player - ported from old/src/utils/ai.js

type Card = { cardFace: string; suit: string }

const BET_HIERARCHY: Record<string, number> = {
  blind: 0,
  insignificant: 1,
  lowdraw: 2,
  meddraw: 3,
  hidraw: 4,
  strong: 5,
  major: 6,
  aggro: 7,
  beware: 8,
}

function generateHistogram(hand: Card[]) {
  return hand.reduce(
    (acc, cur) => {
      acc.frequencyHistogram[cur.cardFace] = (acc.frequencyHistogram[cur.cardFace] || 0) + 1
      acc.suitHistogram[cur.suit] = (acc.suitHistogram[cur.suit] || 0) + 1
      return acc
    },
    { frequencyHistogram: {} as Record<string, number>, suitHistogram: {} as Record<string, number> }
  )
}

function classifyStakes(percentage: number): string {
  if (percentage > 75) return 'beware'
  if (percentage > 40) return 'aggro'
  if (percentage > 35) return 'major'
  if (percentage > 25) return 'strong'
  if (percentage > 15) return 'hidraw'
  if (percentage > 10) return 'meddraw'
  if (percentage > 3) return 'lowdraw'
  if (percentage >= 1) return 'insignificant'
  return 'blind'
}

function decideBetProportion(stakes: string): number {
  const ranges: Record<string, [number, number]> = {
    blind: [0, 0.1],
    insignificant: [0.01, 0.03],
    lowdraw: [0.03, 0.1],
    meddraw: [0.1, 0.15],
    hidraw: [0.15, 0.25],
    strong: [0.25, 0.35],
    major: [0.35, 0.4],
    aggro: [0.4, 0.75],
    beware: [0.75, 1],
  }
  const [min, max] = ranges[stakes] || [0, 0.1]
  return Math.random() * (max - min) + min
}

function willRaise(chance: number): boolean {
  return Math.random() < chance
}

function buildPreFlopDeterminant(
  highCard: number,
  lowCard: number,
  suited: boolean,
  straightGap: boolean
) {
  if (highCard === lowCard) {
    if (highCard > 8) {
      return { callLimit: 'beware', raiseChance: 0.9, raiseRange: ['lowdraw', 'meddraw', 'hidraw', 'strong'] }
    } else if (highCard > 5) {
      return { callLimit: 'aggro', raiseChance: 0.75, raiseRange: ['insignificant', 'lowdraw', 'meddraw'] }
    } else {
      return { callLimit: 'aggro', raiseChance: 0.5, raiseRange: ['insignificant', 'lowdraw', 'meddraw'] }
    }
  } else if (highCard > 9 && lowCard > 9) {
    // Two high cards
    if (suited) {
      return { callLimit: 'beware', raiseChance: 1, raiseRange: ['insignificant', 'lowdraw', 'meddraw', 'hidraw'] }
    } else {
      return { callLimit: 'beware', raiseChance: 0.75, raiseRange: ['insignificant', 'lowdraw', 'meddraw', 'hidraw'] }
    }
  } else if (highCard > 8 && lowCard > 6) {
    // One high card
    if (suited) {
      return { callLimit: 'beware', raiseChance: 0.65, raiseRange: ['insignificant', 'lowdraw', 'meddraw', 'hidraw'] }
    } else {
      return { callLimit: 'beware', raiseChance: 0.45, raiseRange: ['insignificant', 'lowdraw', 'meddraw', 'hidraw'] }
    }
  } else if (highCard > 8 && lowCard < 6) {
    if (suited) {
      return { callLimit: 'major', raiseChance: 0.45, raiseRange: ['insignificant', 'lowdraw'] }
    } else {
      return { callLimit: 'aggro', raiseChance: 0.35, raiseRange: ['insignificant', 'lowdraw'] }
    }
  } else if (highCard > 5 && lowCard > 3) {
    if (suited) {
      return { callLimit: 'strong', raiseChance: 0.1, raiseRange: ['insignificant', 'lowdraw'] }
    } else if (straightGap) {
      return { callLimit: 'aggro', raiseChance: 0, raiseRange: [] }
    } else {
      return { callLimit: 'strong', raiseChance: 0, raiseRange: [] }
    }
  } else {
    if (suited) {
      return { callLimit: 'strong', raiseChance: 0.1, raiseRange: ['insignificant'] }
    } else if (straightGap) {
      return { callLimit: 'strong', raiseChance: 0, raiseRange: [] }
    } else {
      return { callLimit: 'insignificant', raiseChance: 0, raiseRange: [] }
    }
  }
}

function buildGeneralizedDeterminant(handRank: string) {
  const determinants: Record<string, any> = {
    'Royal Flush': { callLimit: 'beware', raiseChance: 1, raiseRange: ['beware'] },
    'Straight Flush': { callLimit: 'beware', raiseChance: 1, raiseRange: ['strong', 'aggro', 'beware'] },
    'Four Of A Kind': { callLimit: 'beware', raiseChance: 1, raiseRange: ['strong', 'aggro', 'beware'] },
    'Full House': { callLimit: 'beware', raiseChance: 1, raiseRange: ['hidraw', 'strong', 'aggro', 'beware'] },
    'Flush': { callLimit: 'beware', raiseChance: 1, raiseRange: ['strong', 'aggro', 'beware'] },
    'Straight': { callLimit: 'beware', raiseChance: 1, raiseRange: ['lowdraw', 'meddraw', 'hidraw', 'strong'] },
    'Three Of A Kind': { callLimit: 'beware', raiseChance: 1, raiseRange: ['lowdraw', 'meddraw', 'hidraw', 'strong'] },
    'Two Pair': { callLimit: 'beware', raiseChance: 0.7, raiseRange: ['lowdraw', 'meddraw', 'hidraw', 'strong'] },
    'Pair': { callLimit: 'hidraw', raiseChance: 0.5, raiseRange: ['lowdraw', 'meddraw', 'hidraw', 'strong'] },
    'No Pair': { callLimit: 'meddraw', raiseChance: 0.2, raiseRange: ['lowdraw', 'meddraw', 'hidraw', 'strong'] },
  }
  return determinants[handRank] || determinants['No Pair']
}

function getCardValue(cardFace: string): number {
  const values: Record<string, number> = {
    A: 14,
    K: 13,
    Q: 12,
    J: 11,
    '10': 10,
    '9': 9,
    '8': 8,
    '7': 7,
    '6': 6,
    '5': 5,
    '4': 4,
    '3': 3,
    '2': 2,
  }
  return values[cardFace] || 0
}

export function makeAIAction(state: any): 'fold' | 'check' | 'bet' | null {
  try {
    const activePlayer = state.players[state.activePlayerIndex]
    if (!activePlayer || !activePlayer.robot) return null

    const highBet = state.highBet || 0
    const hand = activePlayer.hand || []
    const community = state.community || []
    const allCards = hand.concat(community)

    if (allCards.length < 2) return null

    const preFlopValues = hand.map((c: Card) => getCardValue(c.cardFace))
    const highCard = Math.max(...preFlopValues)
    const lowCard = Math.min(...preFlopValues)

    const { frequencyHistogram, suitHistogram } = generateHistogram(allCards)
    const suited = Object.entries(suitHistogram).find((kv) => kv[1] === 2)
    const straightGap = highCard - lowCard <= 4

    // Simple hand evaluation for post-flop (can be expanded later)
    let handRank = 'No Pair'
    if (Object.values(frequencyHistogram).some((v: any) => v >= 2)) {
      handRank = 'Pair'
    }

    const totalInvestment = activePlayer.chips + (activePlayer.bet || 0)
    const investmentRequiredToRemain = highBet > 0 ? (highBet / totalInvestment) * 100 : 0
    const stakes = classifyStakes(investmentRequiredToRemain)

    let callLimit: string
    let raiseChance: number
    let raiseRange: string[]

    if (state.phase === 'betting1') {
      const det = buildPreFlopDeterminant(highCard, lowCard, !!suited, straightGap)
      callLimit = det.callLimit
      raiseChance = det.raiseChance
      raiseRange = det.raiseRange
    } else {
      const det = buildGeneralizedDeterminant(handRank)
      callLimit = det.callLimit
      raiseChance = det.raiseChance
      raiseRange = det.raiseRange
    }

    const willCall = BET_HIERARCHY[stakes] <= BET_HIERARCHY[callLimit]

    if (!willCall) {
      return 'fold'
    }

    // Check if we should raise
    if (willRaise(raiseChance) && raiseRange.length > 0) {
      return 'bet'
    }

    return 'check'
  } catch (e) {
    console.error('AI decision error:', e)
    return 'check'
  }
}

export function getAIBetAmount(state: any, highCard: number): number {
  const activePlayer = state.players[state.activePlayerIndex]
  if (!activePlayer) return 0

  const hand = activePlayer.hand || []
  const highCardVal = Math.max(...hand.map((c: Card) => getCardValue(c.cardFace)))
  const lowCardVal = Math.min(...hand.map((c: Card) => getCardValue(c.cardFace)))

  let stakesCategory = 'strong'
  if (highCardVal > 12) stakesCategory = 'beware'
  else if (highCardVal > 10) stakesCategory = 'aggro'
  else if (highCardVal > 8) stakesCategory = 'major'

  const proportion = decideBetProportion(stakesCategory)
  let betAmount = Math.floor(proportion * activePlayer.chips)

  // Ensure bet meets minimum
  const minBet = state.minBet || 20
  const callBet = state.highBet || minBet
  if (betAmount < callBet) {
    betAmount = Math.min(callBet, activePlayer.chips)
  }

  return Math.max(minBet, betAmount)
}
