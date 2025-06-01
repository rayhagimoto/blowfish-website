---
title: A cute linear regression brainteaser
date: 2024-12-31
draft: false
---

{{< katex >}}

I heard about this problem more than a year ago, I couldn't solve it then and I stopped thinking about it, but I refused to look up a solution because I thought I could do it. Now that I've finished my PhD I decided to revisit it and finally have an answer :)

## Problem Statement

> Consider the (continuously infinite) set of points \\((x,y)\\) in the interior of a rectangle with length \\(2L\\) and width \\(2W\\) centered at the origin, and whose long side makes an angle of \\(0 \leq \theta \leq \pi/4\\) with the \\(x\\)-axis.
> This setup is depicted in the figure below. 
> Now imagine using this set of points to do an ordinary least squares (OLS) regression of the form \\(y = \beta_0 + x \beta_1 + \epsilon\\). 
> What can be said about \\(\beta_1\\)?

<!-- {{< figure src="diagram-1.svg" title="Figure 1: Rectangle with length \\(2L\\) and width \\(2W\\)." id="fig:1" width="50%" >}} -->
{{< svg src="diagram-1.svg" alt="Figure 1: Rectangle with length \(2L\) and width \(2W\)." caption="Figure 1: Rectangle with length \(2L\) and width \(2W\)." width="50%" >}}


_Note: I don't remember the precise statement of the prompt, but I think this captures the essence of the problem very well._

## Solution

Here I will address the problem in two ways. The first is an intuitive, qualitative understanding, and the second is a more formal quantitative result which backs up the intuitive solution.

### Intuitive Approach

Our first guess is that the regressor _should_ give us the straight line that goes through the axis of symmetry of the rectangle parallel to the long side of the rectangle, i.e., the line that makes an angle \\(\theta\\) with the \\(x\\)-axis and intersects the origin.
I will refer to this line as the rectangle's "principal axis".
It is depicted below for the general case as a cyan line. 

{{< svg src="diagram-2.svg" alt="Figure 2: Principal axis illustration." caption="Figure 2: Principal axis illustration." id="fig:2" width="50%" >}}

In the specific case \\(\theta = 0\\) we can be 100% confident the regression line would be the principal axis.
However, when \\(\theta > 0\\) things are not so clear. 
So let's try to imagine what shape would be guaranteed to give the principal axis as the solution. 

Well, if we take the rectangle with \\(\theta = 0\\) and perform a skew transformation so that the edges on the left and right stay parallel to the \\(y\\)-axis, then the symmetry properties of the system dictate that the line of best-fit is the principal axis. 
This is illustrated in the figure below.

{{< svg src="diagram-3.svg" alt="Figure 3: Skewed rectangle and regression line." caption="Figure 3: Skewed rectangle and regression line." id="fig:3" width="50%" >}}

A rectangle that has been rotated about the origin by an angle \\(\theta\\) can be decomposed into 3 shapes: a skew rectangle and two right-angle triangles as shown below. 
The skew rectangle "votes" that the best-fit line is the principal axis as argued earlier. 
But now there are two more contributions, coming from the right triangles on the left and right of the diagram.
If we look at how the principal axis cuts through the rightmost triangle, we observe there is more area below the principal axis, than above, so that triangle "votes" for the best-fit line to be shifted down. 
Similarly, for the leftmost triangle there is more area above the principal axis than below, so it "votes" for the best-fit line to be pulled up on that side. 
The net effect is a rotation toward a less steep slope. 

{{< svg src="diagram-4.svg" alt="Figure 4: Rectangle decomposed into skewed rectangle and two right-triangles." caption="Figure 4: Rectangle decomposed into skewed rectangle and two right-triangles." id="fig:4" width="50%" >}}

So, we expect the regression slope to be biased toward 0.

### Quantitative Analysis

I think the intuitive explanation is really satisfying, but this effect seems extremely similar to _attenuation bias_ which occurs when the _weak exogeneity_ assumption of linear regression is violated. 
I wanted to make this connection more concrete, and this more math-heavy explanation does just that. 

The entire premise of this problem can be restated in the following way. 
First let's denote the "natural" coordinates of the rectangle as \\((u,v)\\). 
Specifically, \\((u,v) = (0,0)\\) is at the center of the rectangle, \\(u\\) increases along the principal axis of the rectangle, and \\(v\\) is orthogonal to it.
More specifically, I'll take it to be in the direction measured \\(\pi/2\\) radians counter-clockwise from the principal axis.
In the figures above \\(v\\) increases as you move up and to the left.

The statement that the rectangle has a uniform density of points can be restated as sampling points \\((u,v)\\) uniformly at random from the region \\((u,v) \in [-L, L] \times [-W, W]\\).
In other words,

$$
    \begin{align}
    u &\sim \mathrm{U}(-L, L) \\
    v &\sim \mathrm{U}(-W, W) \  .
    \end{align}
$$

To get their coordinates in terms of \\((x,y)\\) we simply rotate \\((u,v)\\) counter-clockwise by an angle \\(\theta\\) to yield 

$$
    \begin{align}
    x &= \cos \theta  u - \sin \theta  v \\
    y &= \sin \theta  u + \cos \theta  v \ .
    \end{align}
$$

The OLS estimator for the slope, \\(\beta_1\\) is 

$$  
    \frac{\mathrm{Cov}(x,y)}{\mathrm{Var}(x)} \ .
$$
Since we're regressing on the continuous infinity of points drawn from the distribution, \\(\mathrm{Var}\\) and \\(\mathrm{Cov}\\) denote the true variance and covariance.
For the covariance we have,
$$
    \mathrm{Cov}(x,y) 
    = \mathbb{E}[x  (\beta_0 + \beta_1 x + \epsilon)] - \mathbb{E}(x) \mathbb{E}(\beta_0 + \beta_1 x + \epsilon) \ .
$$
Using the expressions we derived for \\(x\\) and \\(y\\) in terms of \\(u\\) and \\(v\\), and noting that \\(\mathbb{E}(u) = \mathbb{v} = 0\\), and \\(\mathrm{Var}(u) = L^2 / 3\\), \\(\mathrm{Var}(v) = W^2 / 3\\) one can show that 
$$
    \mathrm{Cov}(x,y) = \frac{1}{3} (L^2 - W^2) \cos\theta \sin\theta
$$
and
$$
    \mathrm{Var}(x) = \frac{1}{3} (L^2 \cos^2 \theta + W^2 \sin^2\theta) \ .
$$
Hence, we have 
$$
    \hat{\beta}_1 = \frac{(L^2 - W^2)\cos\theta \sin\theta}{L^2 \cos^2\theta + W^2 \sin^2\theta} 
    = \frac{1 - (W / L)^2}{1 + (W / L)^2 \tan^2 \theta}  \tan \theta \ .
$$
Since we naiively expect the regression line to have a slope near \\(\tan \theta\\), the factor in front is a multiplicative bias. Moreover, since here we assume \\(W < L\\), the bias is \\(< 1\\), implying a shallower slope. 

### Numerical Verification

Below, the cyan-filled rectangle represents the data domain, rotated by an angle \\(\theta\\) relative to the \\(x\\)-axis. The cyan dotted line shows the principal axis of the rectangle, with a slope of \\(\tan(\theta)\\). The red solid line represents the theoretical regression line, calculated based on the derived formula for \\(\beta_1\\), while the dashed black line corresponds to the OLS regression line obtained from numerical calculations. Each subplot displays the \\(R^2\\) value of the regression, providing a measure of the goodness of fit. The comparison between the theoretical regression slope (red), the numerical regression slope (dashed black), and the principal axis (cyan) highlights the bias introduced by the rectangular geometry. This visualization confirms that the numerical results closely align with the theoretical predictions across varying rectangle dimensions and angles.


{{< svg src="fig.svg" alt="Figure 5: Illustration of the relationship between the OLS regression slope, the principal axis of the rectangle, and the theoretical regression line for datasets confi" caption="Figure 5: Illustration of the relationship between the OLS regression slope, the principal axis of the rectangle, and the theoretical regression line for datasets confi" width="50%" >}}
