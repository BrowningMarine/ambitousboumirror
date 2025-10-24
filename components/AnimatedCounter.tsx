"use client";
import { useState, useEffect, useCallback, useRef } from "react";
import CountUp from "react-countup";

interface AnimatedCounterProps {
  amount: number;
  start?: number; // Optional starting value
  isCountDown?: boolean; // Flag to indicate counting down
  duration?: number; // Custom duration (will be overridden if dynamicDuration is true)
  prefix?: string; // Custom prefix (like $)
  suffix?: string; // Custom suffix (like ₫)
  decimals?: number; // Number of decimal places
  dynamicDuration?: boolean; // Whether to adjust duration based on value difference
  minDuration?: number; // Minimum animation duration
  maxDuration?: number; // Maximum animation duration
}

const AnimatedCounter = ({
  amount,
  start,
  isCountDown = false,
  duration = 2,
  prefix = "",
  suffix = "",
  decimals = 2,
  dynamicDuration = true,
  minDuration = 0.5,
  maxDuration = 3,
}: AnimatedCounterProps) => {
  // Track animation state
  const [isAnimating, setIsAnimating] = useState(true);
  const previousAmountRef = useRef<number>(
    start !== undefined ? start : isCountDown ? amount : 0
  );
  const currentAmountRef = useRef<number>(amount);

  // When amount changes, track the change and reset animation state
  useEffect(() => {
    if (previousAmountRef.current !== amount) {
      previousAmountRef.current = currentAmountRef.current;
      currentAmountRef.current = amount;
      setIsAnimating(true);
    }
  }, [amount]);

  // Calculate a dynamic duration based on the amount difference
  // Wrap in useCallback to prevent dependency issues
  const calculateDynamicDuration = useCallback(
    (startVal: number, endVal: number): number => {
      if (!dynamicDuration) return duration;

      // Calculate the absolute difference
      const diff = Math.abs(endVal - startVal);

      if (diff === 0) return minDuration;

      // Use logarithmic scale for better perception
      // Log base 10 of the difference to handle various scales
      const logDiff = Math.log10(diff + 1); // +1 to handle small values

      // Normalize to our min/max duration range
      // For small changes: closer to minDuration
      // For large changes: closer to maxDuration
      const normalizedDuration =
        minDuration + (logDiff / 6) * (maxDuration - minDuration); // Divide by 6 to scale appropriately

      // Ensure we're within our boundaries
      return Math.min(Math.max(normalizedDuration, minDuration), maxDuration);
    },
    [duration, dynamicDuration, minDuration, maxDuration]
  );

  // For counting down, we always want to go from the higher number to the lower number
  let startValue, endValue;

  if (isCountDown) {
    // If countdown mode and start is provided, go from start to amount
    // Otherwise, go from amount to 0
    startValue = start !== undefined ? start : amount;
    endValue = start !== undefined ? amount : 0;
  } else {
    // In count up mode, always start from 0 if no start value is provided
    startValue = start !== undefined ? start : 0;
    endValue = amount;
  }

  // Calculate the dynamic duration based on the difference
  const animationDuration = calculateDynamicDuration(startValue, endValue);

  // Set animation to complete after duration
  useEffect(() => {
    if (startValue === endValue) {
      setIsAnimating(false);
      return;
    }

    const timer = setTimeout(() => {
      setIsAnimating(false);
    }, animationDuration * 1000 + 100); // Add small buffer

    return () => clearTimeout(timer);
  }, [animationDuration, startValue, endValue]);

  // Set color based on direction and animation state
  // Force the color based on isCountDown prop to ensure consistent coloring
  const textColorClass = isAnimating
    ? isCountDown
      ? "text-red-500"
      : "text-green-500"
    : "text-black"; // Change to black after animation

  // Calculate the current and target values to determine appropriate width
  const currentValue = Math.abs(endValue);
  const transitionValue = Math.abs(startValue);

  // Use the larger of the two values to determine width during animation
  const relevantValue = Math.max(currentValue, transitionValue);

  // Format the number to see how it will actually display (with thousand separators)
  const formattedRelevantValue = relevantValue.toLocaleString("en-US", {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  });

  // Calculate character width based on the formatted string
  const relevantFormattedLength = formattedRelevantValue.length;
  const prefixLength = prefix.length;
  const suffixLength = suffix.length;

  // Calculate total character width needed (exact size)
  const totalChars = relevantFormattedLength + prefixLength + suffixLength;

  return (
    <div className={`${textColorClass} font-semibold`}>
      <div
        className="inline-block text-right font-mono tabular-nums"
        style={{
          minWidth: `${totalChars}ch`, // Use 'ch' unit for character width
        }}
      >
        <CountUp
          start={startValue}
          end={endValue}
          duration={animationDuration}
          decimals={decimals}
          decimal="."
          prefix={prefix}
          suffix={suffix}
          useEasing={true}
          preserveValue={true}
          redraw={false}
          onEnd={() => setIsAnimating(false)}
        />
      </div>
    </div>
  );
};

export default AnimatedCounter;
