---
date: 2024-12-31
draft: false
title: Drunken Walk / Gambler's Ruin
---

{{< katex >}}

I was recently asked a question which I forgot the intuition for, so I wanted to write a post that approaches it from a few different perspectives and share how I got my intuition back.
In the interest of entertaining myself I have reworded the problem with a ridiculous scenario that still preserves the mathematical statement of the problem.

> Imagine you get into a high speed chase with the cops. You catch a lucky break and veer out of sight but end up crashing \\(X_\mathrm{init} = 100\\) meters from the last location where the cops saw you. 
> You proceed to get out of the vehicle and continue running away on foot, but in a state of shock, each stride you either take one step away from the cops with probability \\(p\\) or accidentally take a step backwith probability \\(q = 1 - p\\). 
> 
> Your safehouse is just 1,000 meters away from where the cops last saw you (\\(X = 1000\\)), but if you take too many steps back you'll end up being captured by the cops, who are looking for you at your last known location \\((X = 0)\\).
>
> Assume the distance you cover in a single step is \\(\Delta x\\) meters and you're physically capable of taking steps as small as \\(0.1\\) meters or as large as \\(100\\) meters (you're either superhuman or you have a collection of ender pearls in your inventory).
>
> What step size should you take assuming you have infinite time, and will only get caught if you stumble to \\(X = 0\\)?

**Parameters:**
$$
\begin{align*}
X_\mathrm{init} &= 100 \text{ meters} \\
X_\mathrm{target} &= 1000 \text{ meters} \\
X_\mathrm{capture} &= 0 \text{ meters} \\
P(\text{step forward}) &= p \\
P(\text{step backward}) &= q = 1 - p \\
\text{Step size} &= \Delta x \in [0.1, 100] \text{ meters}
\end{align*}
$$

I'll lead with the intuition and a relatively simple argument first. 

## First Solution (Quick)

The larger steps you take, the more variance you'll experience per step. For example, if you bounce \\(100\\) meters then you have a probability \\(q\\) of getting arrested after just one step. 
On the other hand, if you take a small step like \\(0.1\\) meters, you only move a little bit, but it'll take you 1,000 steps to cover the same total distance (and I do mean _distance_ in the physics sense of the word, not displacement). 

For a given \\(\Delta x\\) we know that the variance of your position increases with the number of steps, but for a given number of steps it decreases when you take smaller steps; so what we're really trying to get at is the tradeoff between having more small steps versus fewer large steps. 
From the first example we considered it is already apparent that smaller steps are better for the first step, but we can build our intuition more by thinking about what happens when you take more and more smaller steps.
Imagine taking the limit \\(\Delta x \rightarrow 0\\) for a fixed distance traveled:
$$
n \Delta x = d = \mathrm{constant}
$$

As you take smaller and smaller steps you have to take proportionately more steps to move the same distance.
Your net displacement is the sum of these steps:
$$
\sum_{i=1}^n \Delta X_i = n \overline{\Delta X}
$$

In the limit of infinitely many steps \\(\overline{\Delta X}\\) converges to the expectation value of a single step:
$$
\overline{\Delta X} \rightarrow \Delta x (p - q)
$$

Hence your net displacement converges to:
$$
n \Delta x (p - q) = d(p - q)
$$

which is just a number, not a random variable. 
In other words, in the limit of infinitely small steps you literally just walk in a straight line, never backtracking towards the police, which is ideal.
The closest we can get to that based on the constraints is taking steps of \\(0.1\\) meters, so we choose that as our preferred answer.

Let's explore what this means from a highly related, but slightly different perspective.
To reiterate, a walk is described by your initial position plus the cumulative sum of a sequence of random steps:
$$
\{\Delta X_i : i = 1, 2, ...\}
$$

Each step is IID and can be expressed as:
$$
\Delta X_i = \Delta x \, Z_i
$$

where \\(Z_i\\) is sampled from a distribution that yields \\(+1\\) with probability \\(p\\) or \\(-1\\) with probability \\(q\\).
In other words each step has a variance proportional to \\((\Delta x)^2\\), and the sum of \\(n\\) steps has a variance proportional to:
$$
n (\Delta x)^2
$$

Notice that \\(n\\) shows up with a power of \\(1\\) and \\(\Delta x\\) shows up with a power of \\(2\\). 
Hence, when we take the limit of small steps, but keep the amount of distance traveled constant we fix a factor of \\(n \Delta x\\), but the remaining \\(\Delta x\\) keeps shrinking, collapsing the variance to 0.

## Simulations

Of course, when I needed it the most, I didn't have the intuition above because I panicked.
I was able to come up with the explanation above by doing my favourite past-time activity: writing up Monte Carlo simulations 😀

## In-depth solution

In this section I'll share a more complicated solution which is how I originally understood this prooblem, but it's too long and impractical to use in an interview setting unless you happen to memorize the final answer (which I never do).

Let's forget about the original problem statement for now, and just treat it like a Markov process with absorbing boundary conditions at \\(x_\mathrm{low} = 0\\) and \\(x_\mathrm{high} = 1000\\). 
Fix the step size \\(\Delta x\\) and define the grid of valid states as \\(\{x_k = k \Delta x : k = 1, 2, \dots N \}\\), where \\(N \equiv x_\mathrm{high} / \Delta x\\). 
As in the original prompt we'll denote the probability of moving towards \\(x_\mathrm{high}\\) in a given step by \\(p\\), and we'll let \\(q = 1 - p\\).
For convenience, denote the probability of escaping the police, starting at state \\(x_m\\) by \\(q_m\\). That is,

$$
  q_m \equiv \mathrm{Pr}(\, \mathrm{escape} \, |\, x_\mathrm{initial} = x_m \,) \ .
$$

Trivially, at \\(m = 0\\) and \\(m = N\\) we have,

$$
  \begin{align*}
    q_0 &= 0 \\
    q_N &= 1 
  \end{align*}
$$

Doing a 'next-step' analysis, we observe that if you're at state \\(x_m\\) now, then after one step you will either be at \\(x_{m-1}\\) or \\(x_{m+1}\\), at which point if we knew \\(q_{m-1}\\) and \\(q_{m+1}\\) then we could calculate \\(q_m\\) as,

$$
  \begin{align*}
    q_m = p \, q_{m + 1} + q \, q_{m-1} \ .
  \end{align*}
$$

Using the fact that \\(p + q = 1\\) we can write the left hand side as 

$$
  \begin{align*}
    q_m = (p + q) \, = p \, q_m + q \, q_m \ .
  \end{align*}
$$

Subtracting the latter from the RHS yields 

$$
  \begin{align}
    0 = p \, (q_{m + 1} - q_m) + q \, (q_{m-1} - q_m)
  \end{align}
$$

Now, if we define \\(F_m \equiv q_{m} - q_{m - 1}\\) and introduce the inverse odds \(r \equiv q / p\) we can rearrange eqn (1) as

$$
  \begin{align*}
    F_{m+1} =  \frac{q}{p} \, F_m = r F_m \ .
  \end{align*}
$$

Induction then tells us

$$
  \begin{align}
    F_{m+1} =  r^m \, F_1 = r^m q_1 \ .
  \end{align}
$$

On the other hand, using the definition of \( F_m \) we observe that \( q_m = \sum_{k=1}^m F_k \). 
So, in combination with eqn (2) we have 

$$
  \begin{align*}
    q_m = \sum_{k=1}^m F_k = \sum_{k=1}^m r^{k-1} q_1 = \frac{q_1}{r} \sum_{k=0}^{m-1} r^{k-1} = \frac{q_1}{r}\frac{1 - r^m}{1 - r}\ .
  \end{align*}
$$

To solve for \(q_1\) we apply the boundary condition \(q_N = 1\):

$$
  \begin{align*}
    1 = q_N = \frac{q_1}{r}\frac{1 - r^N}{1 - r} \Rightarrow \frac{q_1}{r} = \frac{1 - r}{1 - r^N} \ .
  \end{align*}
$$

And so,

$$
  \begin{align}
    \boxed{q_m = \frac{1 - (q / p)^m}{1 - (q / p)^N}}\ .
  \end{align}
$$

Eqn (3) can be used to solve our original problem. Since \(N = x_\mathrm{end} / \Delta x\) and \(m = x_\mathrm{initial} / \Delta x\) we immediately see that taking smaller steps is equivalent to sending $m$ and $N$ to infinity at the same rate, so

$$
  \begin{align*}
    \lim_{\Delta x \rightarrow 0} \mathrm{Pr}(\mathrm{escape}) = 1. 
  \end{align*}
$$

And clearly we should pick the smallest possible value of \( \Delta x \) permitted. 